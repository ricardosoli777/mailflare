import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "maillead-capture-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({ entryPoints: [join(root, entry)], outfile: join(outDir, outfile), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent", alias: { "@": join(root, "src") } });
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const capture = await bundle("src/lib/marketing/capture.ts", "capture.mjs");
const store = await bundle("src/lib/marketing/contacts.ts", "contacts.mjs");
const pages = await bundle("src/lib/marketing/capture-page.ts", "pages.mjs");

function database() {
	const sqlite = new DatabaseSync(":memory:");
	for (const file of readdirSync(join(root, "drizzle-marketing")).sort()) sqlite.exec(readFileSync(join(root, "drizzle-marketing", file), "utf8"));
	const statement = (sql, values = []) => ({
		bind: (...bound) => statement(sql, bound),
		all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
		first: async () => sqlite.prepare(sql).get(...values) ?? null,
		run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
	});
	return {
		prepare: (sql) => statement(sql),
		batch: async (statements) => {
			for (const item of statements) await item.run();
		},
		sqlite,
	};
}

const NOW = Date.parse("2026-11-26T12:00:00Z");
const HOUR = 3600000;

async function setup({ doubleOptIn = true } = {}) {
	const db = database();
	const list = await store.createMailingList(db, "Clientes");
	const id = await capture.createForm(db, { name: "Novidades", listId: list.id, tags: ["site"], consentText: "Aceito receber", doubleOptIn }, NOW);
	const form = await capture.getForm(db, id);
	const mails = [];
	const submit = (email, now = NOW, deps = {}) => capture.submitForm(db, form, { email, name: "Ana" }, { sendConfirmation: async (to, _name, token) => mails.push({ to, token }), ...deps }, now);
	const status = async () => (await store.listContacts(db)).contacts.map((contact) => `${contact.email}:${contact.status}`);
	const reasons = () => db.sqlite.prepare("SELECT reason FROM marketing_suppressions").all().map((row) => row.reason);
	return { db, list, form, mails, submit, status, reasons };
}

test("double opt-in: nothing is stored as a contact until the person confirms (R6)", async () => {
	const { db, list, mails, submit, status } = await setup();
	assert.deepEqual(await submit(" Ana@Gmail.com "), { ok: true, confirm: true });
	assert.deepEqual(await status(), []);
	assert.equal(mails[0].to, "ana@gmail.com");
	assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM marketing_pending WHERE token_hash = ?").get(mails[0].token).n, 0, "only a hash of the token is kept");

	assert.equal(await capture.confirmSubscription(db, "wrong-token", NOW), false);
	assert.equal(await capture.confirmSubscription(db, mails[0].token, NOW + HOUR), true);
	assert.equal(await capture.confirmSubscription(db, mails[0].token, NOW + HOUR), true, "clicking twice is harmless");
	assert.deepEqual(await status(), ["ana@gmail.com:subscribed"]);
	const [contact] = (await store.listContacts(db)).contacts;
	assert.deepEqual(contact.tags, ["site"]);
	assert.equal((await store.getContact(db, contact.id)).consents.length, 1);
	assert.equal((await store.eligibleRecipients(db, list.id)).length, 1);
});

test("a confirmation link expires after seven days", async () => {
	const { db, mails, submit, status } = await setup();
	await submit("ana@gmail.com");
	assert.equal(await capture.confirmSubscription(db, mails[0].token, NOW + capture.CONFIRM_TTL_MS + 1), false);
	assert.deepEqual(await status(), []);
});

test("a form cannot be used to flood an address or the sender", async () => {
	const { db, mails, submit } = await setup();
	await submit("ana@gmail.com");
	await submit("ana@gmail.com", NOW + 1000);
	assert.equal(mails.length, 1, "one confirmation per address per hour");
	await submit("ana@gmail.com", NOW + HOUR + 1000);
	assert.equal(mails.length, 2);

	for (let index = 0; index < capture.MAX_CONFIRMATIONS_PER_DAY; index++) {
		db.sqlite.prepare("INSERT INTO marketing_pending (token_hash, form_id, email, created_at) VALUES (?, 'x', ?, ?)").run(`h${index}`, `p${index}@gmail.com`, NOW + 2 * HOUR);
	}
	assert.equal((await submit("novo@gmail.com", NOW + 3 * HOUR)).ok, false);
	assert.equal(mails.length, 2);
});

test("a failed confirmation mail does not block the next attempt", async () => {
	const { db, submit, mails } = await setup();
	const original = console.error;
	console.error = () => {};
	try {
		assert.equal((await submit("ana@gmail.com", NOW, { sendConfirmation: async () => { throw new Error("SES"); } })).ok, false);
	} finally {
		console.error = original;
	}
	assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM marketing_pending").get().n, 0);
	assert.equal((await submit("ana@gmail.com", NOW + 1000)).ok, true);
	assert.equal(mails.length, 1);
});

test("bad addresses are refused and a bounced one gets the same answer but no mail", async () => {
	const { db, submit, mails } = await setup();
	assert.equal((await submit("sem-arroba")).ok, false);
	assert.equal((await submit("a@nao.existe", NOW, { checkDomain: async () => "o domínio não existe" })).ok, false);
	await submit("ana@gmail.com");
	await capture.confirmSubscription(db, mails[0].token, NOW);
	db.sqlite.prepare("INSERT INTO marketing_suppressions (email_hash, reason, created_at) SELECT email_hash, 'complaint', 0 FROM marketing_contacts").run();
	assert.deepEqual(await submit("ana@gmail.com", NOW + 2 * HOUR), { ok: true, confirm: true });
	assert.equal(mails.length, 1);
});

test("asking again and confirming brings back this list only", async () => {
	const { db, list, mails, submit, status, reasons } = await setup();
	const other = await store.createMailingList(db, "Outra");
	await submit("ana@gmail.com");
	await capture.confirmSubscription(db, mails[0].token, NOW);
	const [contact] = (await store.listContacts(db)).contacts;
	await store.updateContact(db, contact.id, { listIds: [list.id, other.id] }, NOW);
	await store.unsubscribeAll(db, contact.id, "teste", NOW);

	await submit("ana@gmail.com", NOW + 2 * HOUR);
	assert.deepEqual(reasons(), ["unsubscribe"], "submitting alone changes nothing");
	assert.equal(await capture.confirmSubscription(db, mails[1].token, NOW + 2 * HOUR), true);
	assert.deepEqual(reasons(), []);
	assert.deepEqual(await status(), ["ana@gmail.com:subscribed"]);
	assert.equal((await store.eligibleRecipients(db, list.id)).length, 1);
	assert.equal((await store.eligibleRecipients(db, other.id)).length, 0);
});

test("erasing a person also removes what was waiting for confirmation", async () => {
	const { db, mails, submit } = await setup();
	await submit("ana@gmail.com");
	await capture.confirmSubscription(db, mails[0].token, NOW);
	await store.eraseContact(db, (await store.listContacts(db)).contacts[0].id, NOW);
	assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM marketing_pending").get().n, 0);
	assert.equal(await capture.confirmSubscription(db, mails[0].token, NOW), false);
});

test("a form without confirmation adds at once but never lifts a block", async () => {
	const { db, submit, status } = await setup({ doubleOptIn: false });
	assert.deepEqual(await submit("ana@gmail.com"), { ok: true, confirm: false });
	assert.deepEqual(await status(), ["ana@gmail.com:subscribed"]);
	await capture.unsubscribeEmail(db, "ana@gmail.com", NOW);
	assert.deepEqual(await submit("ana@gmail.com", NOW + HOUR), { ok: true, confirm: false });
	assert.deepEqual(await status(), ["ana@gmail.com:unsubscribed"]);
});

test("unsubscribing an unknown address keeps it out from then on", async () => {
	const { db, list } = await setup();
	assert.equal(await capture.unsubscribeEmail(db, "ruim", NOW), false);
	assert.equal(await capture.unsubscribeEmail(db, "Bia@gmail.com", NOW), true);
	const report = await store.importContacts(db, [{ line: 1, email: "bia@gmail.com", name: "", fields: {} }], { listId: list.id, consent: null, origin: "teste" });
	assert.equal(report.rejected.length, 1);
});

test("deleting the list turns the form and webhook off", async () => {
	const { db, list, form } = await setup();
	const hook = await capture.createHook(db, { name: "Vendas", listId: list.id, tags: [], consentText: "Aceito" }, NOW);
	await store.deleteMailingList(db, list.id);
	assert.equal(await capture.getForm(db, form.id), null);
	assert.equal(await capture.getHook(db, hook), null);
});

test("forms and webhooks need a name, a consent text and an existing list", async () => {
	const { db, list } = await setup();
	assert.ok((await capture.readTarget(db, { listId: list.id, consentText: "x" })).error);
	assert.ok((await capture.readTarget(db, { name: "a", listId: list.id })).error);
	assert.ok((await capture.readTarget(db, { name: "a", listId: "nada", consentText: "x" })).error);
	assert.deepEqual((await capture.readTarget(db, { name: " a ", listId: list.id, consentText: "x", tags: "A, b" })).tags, ["a", "b"]);
});

test("API keys are stored only as a hash and stop working when deleted (I2)", async () => {
	const { db } = await setup();
	const key = await capture.createApiKey(db, "site", NOW);
	assert.match(key, /^mk_/);
	const stored = db.sqlite.prepare("SELECT * FROM marketing_api_keys").get();
	assert.ok(!Object.values(stored).includes(key));
	assert.equal(await capture.authenticateKey(db, `Bearer ${key}`, NOW + 5), true);
	assert.equal((await capture.listCapture(db)).keys[0].lastUsedAt, NOW + 5);
	assert.equal(await capture.authenticateKey(db, `Bearer ${key}x`), false);
	assert.equal(await capture.authenticateKey(db, key), false);
	assert.equal(await capture.authenticateKey(db, null), false);
	await capture.deleteCapture(db, "key", stored.id);
	assert.equal(await capture.authenticateKey(db, `Bearer ${key}`), false);
	assert.equal(capture.isCaptureKind("toString"), false);
});

test("a webhook accepts only a body signed with its secret (I3)", async () => {
	const body = '{"email":"ana@gmail.com"}';
	const signature = createHmac("sha256", "segredo").update(body).digest("hex");
	assert.equal(await capture.verifyHookSignature("segredo", body, signature), true);
	assert.equal(await capture.verifyHookSignature("segredo", body, `sha256=${signature.toUpperCase()}`), true);
	assert.equal(await capture.verifyHookSignature("segredo", `${body} `, signature), false);
	assert.equal(await capture.verifyHookSignature("outro", body, signature), false);
	assert.equal(await capture.verifyHookSignature("segredo", body, null), false);
});

test("extra fields are chosen per form, required ones enforced and the answers kept on the contact", async () => {
	const { db, list, mails, status } = await setup();
	const extras = capture.readFormExtras({ fields: [{ label: " Telefone ", required: true }, { label: "Cidade" }, { label: "E-mail" }, { label: "telefone" }, { label: "" }], button: " Baixar " });
	assert.deepEqual(extras, { fields: [{ key: "telefone", label: "Telefone", required: true }, { key: "cidade", label: "Cidade", required: false }], button: "Baixar", whatsappText: "" });
	const id = await capture.createForm(db, { name: "Vendas", listId: list.id, tags: [], consentText: "Aceito", ...extras }, NOW);
	const form = await capture.getForm(db, id);
	const send = { sendConfirmation: async (to, _name, token) => mails.push({ to, token }) };
	assert.equal((await capture.submitForm(db, form, { email: "ana@gmail.com", name: "Ana", fields: { cidade: "Recife" } }, send, NOW)).ok, false);
	await capture.submitForm(db, form, { email: "ana@gmail.com", name: "Ana", fields: { telefone: "81 99999-0000", outro: "x" } }, send, NOW);
	await capture.confirmSubscription(db, mails[0].token, NOW);
	assert.deepEqual(await status(), ["ana@gmail.com:subscribed"]);
	const contactId = (await store.listContacts(db)).contacts[0].id;
	assert.deepEqual((await store.getContact(db, contactId)).fields, { telefone: "81 99999-0000" });

	// A later submission adds what was missing without overwriting what is known.
	await store.importContacts(db, [{ line: 1, email: "ana@gmail.com", name: "", fields: { telefone: "0", cidade: "Recife" } }], { listId: list.id, consent: null, origin: "teste" });
	assert.deepEqual((await store.getContact(db, contactId)).fields, { telefone: "81 99999-0000", cidade: "Recife" });

	assert.equal(await capture.updateForm(db, id, { name: "Vendas 2", listId: list.id, tags: [], consentText: "Aceito", fields: [], button: "Ir" }), true);
	assert.equal((await capture.getForm(db, id)).button, "Ir");
	const html = await pages.formPage(form).text();
	assert.ok(html.includes('name="campo.telefone" type="tel"') && html.includes(">Baixar</button>"));
});

test("public pages escape what they show", async () => {
	const form = { id: "f", name: "<b>x</b>", listId: "l", tags: [], consentText: '"><script>1</script>', doubleOptIn: true, fields: [{ key: "\"><x", label: "\"><x", required: false }], button: "<x>" };
	const html = await pages.formPage(form, { email: '"><img src=x>', error: "<i>" }).text();
	assert.ok(!html.includes("<script>1") && !html.includes("<img src=x>") && !html.includes("<b>x</b>") && !html.includes("<x"));
	assert.ok(!html.includes('data-action="capture"'));
	assert.ok((await pages.formPage(form, { siteKey: "chave" }).text()).includes("cf-turnstile"));
	const message = pages.confirmationMessage("KLEAD", "<x>", "https://a.example/k/t");
	assert.ok(!message.html.includes("<x>") && message.html.includes("https://a.example/k/t") && message.text.includes("https://a.example/k/t"));
});

test("WhatsApp needs its own tick, waits for the e-mail confirmation and can be stopped", async () => {
	const { db, list } = await setup();
	const id = await capture.createForm(db, { name: "Zap", listId: list.id, tags: [], consentText: "Aceito", doubleOptIn: true, ...capture.readFormExtras({ whatsapp: true }) }, NOW);
	const form = await capture.getForm(db, id);
	assert.ok(pages.formPage(form));
	assert.match(await pages.formPage(form).text(), /type="checkbox" name="whatsapp_ok" value="1" style="[^"]+">/, "the box starts unticked");
	const mails = [];
	const send = (email, whatsapp, now = NOW) => capture.submitForm(db, form, { email, name: "Ana", whatsapp }, { sendConfirmation: async (_to, _name, token) => mails.push(token) }, now);
	const phones = () => db.sqlite.prepare("SELECT phone FROM marketing_whatsapp WHERE opted_out_at IS NULL").all().map((row) => row.phone);

	assert.equal((await send("ana@gmail.com", "123")).ok, false);
	await send("ana@gmail.com", "(11) 99999-0000");
	assert.deepEqual(phones(), [], "nothing before the confirmation");
	await capture.confirmSubscription(db, mails[0], NOW);
	assert.deepEqual(phones(), ["5511999990000"]);

	await send("bia@gmail.com", undefined);
	await capture.confirmSubscription(db, mails[1], NOW);
	assert.equal(phones().length, 1, "without the tick there is no permission");

	const ana = db.sqlite.prepare("SELECT id FROM marketing_contacts WHERE email = 'ana@gmail.com'").get().id;
	assert.equal(await store.stopWhatsApp(db, ana, NOW), true);
	assert.deepEqual(phones(), []);
	await store.eraseContact(db, ana, NOW);
	assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM marketing_whatsapp").get().n, 0);
});
