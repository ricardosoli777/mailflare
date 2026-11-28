import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "maillead-contacts-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({ entryPoints: [join(root, entry)], outfile: join(outDir, outfile), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent", alias: { "@": join(root, "src") } });
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const store = await bundle("src/lib/marketing/contacts.ts", "contacts.mjs");
const utils = await bundle("src/lib/marketing/contacts-utils.ts", "utils.mjs");
const links = await bundle("src/lib/marketing/unsubscribe.ts", "unsubscribe.mjs");
const render = await bundle("src/lib/marketing/render.ts", "render.mjs");
const domains = await bundle("src/lib/marketing/domain-check.ts", "domain.mjs");

/** The D1 calls the module uses, over an in-memory SQLite built from the real migrations. */
function database() {
	const sqlite = new DatabaseSync(":memory:");
	for (const file of readdirSync(join(root, "drizzle-marketing")).sort()) sqlite.exec(readFileSync(join(root, "drizzle-marketing", file), "utf8"));
	const statement = (sql, values = []) => ({
		bind: (...bound) => {
			assert.ok(bound.length <= 100, "D1 allows 100 bound parameters");
			return statement(sql, bound);
		},
		all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
		first: async () => sqlite.prepare(sql).get(...values) ?? null,
		run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
	});
	return {
		prepare: (sql) => statement(sql),
		batch: async (statements) => {
			const results = [];
			for (const item of statements) results.push(await item.run());
			return results;
		},
		sqlite,
	};
}

const consent = { source: "compra", text: "Aceito receber novidades", consentedAt: Date.parse("2026-11-01") };
const row = (email, line = 2) => ({ line, email, name: "", fields: {} });

async function setup() {
	const db = database();
	const list = await store.createMailingList(db, "Clientes");
	const add = (emails, options = {}) => store.importContacts(db, emails.map((email, index) => row(email, index + 2)), { listId: list.id, consent, origin: "teste", ...options });
	const find = async (email) => (await store.listContacts(db, { q: email })).contacts[0];
	const recipients = async () => (await store.eligibleRecipients(db, list.id)).map((item) => item.email);
	return { db, list, add, find, recipients };
}

test("C3: only people with a recorded consent can receive", async () => {
	const { db, add, find, recipients } = await setup();
	await add(["com@gmail.com"]);
	await add(["sem@gmail.com"], { consent: null });
	assert.deepEqual(await recipients(), ["com@gmail.com"]);
	assert.equal((await find("sem@gmail.com")).status, "no_consent");
	assert.equal((await store.getContact(db, (await find("com@gmail.com")).id)).consents.length, 1);
});

test("C4: invalid, repeated and dead-domain rows are reported and not stored", async () => {
	const { add, recipients } = await setup();
	const report = await add(["Ana@Gmail.com", "ana@gmail.com", "sem-arroba", "x@morto.example"], { checkDomain: async (domain) => (domain === "morto.example" ? "morto" : null) });
	assert.equal(report.added, 1);
	assert.deepEqual(report.rejected.map((item) => [item.line, item.reason]), [[3, "repetido no arquivo"], [4, "e-mail inválido"], [5, "morto"]]);
	assert.deepEqual(await recipients(), ["ana@gmail.com"]);
});

test("U3 and U6: whoever left receives nothing, and importing again does not bring them back", async () => {
	const { db, list, add, find, recipients } = await setup();
	await add(["a@gmail.com", "b@gmail.com"]);
	const person = await find("a@gmail.com");
	assert.equal(await store.canReceive(db, person.id, list.id), true);
	await store.unsubscribeAll(db, person.id, "um clique");
	assert.equal(await store.canReceive(db, person.id, list.id), false);
	const again = await add(["a@gmail.com"]);
	assert.equal(again.added + again.updated, 0);
	assert.equal(again.rejected.length, 1);
	await store.updateContact(db, person.id, { listIds: [list.id], consent });
	assert.deepEqual(await recipients(), ["b@gmail.com"]);
	assert.equal((await find("a@gmail.com")).status, "unsubscribed");
});

test("U4 and U6: leaving one list is kept through imports and edits", async () => {
	const { db, list, add, find, recipients } = await setup();
	await add(["a@gmail.com"]);
	const person = await find("a@gmail.com");
	await store.saveListPreferences(db, person.id, []);
	assert.deepEqual(await recipients(), []);
	await add(["a@gmail.com"]);
	await store.updateContact(db, person.id, { listIds: [] });
	await store.updateContact(db, person.id, { listIds: [list.id] });
	assert.deepEqual(await recipients(), []);
	await store.saveListPreferences(db, person.id, [list.id]);
	assert.deepEqual(await recipients(), ["a@gmail.com"]);
});

test("C6: erasing removes the data, and the address can be added again", async () => {
	const { db, add, find, recipients } = await setup();
	await add(["a@gmail.com"], { tags: ["vip"] });
	await store.eraseContact(db, (await find("a@gmail.com")).id);
	for (const table of ["marketing_contacts", "marketing_consents", "marketing_events", "marketing_list_members", "marketing_contact_tags", "marketing_suppressions"]) {
		assert.doesNotMatch(JSON.stringify(db.sqlite.prepare(`SELECT * FROM ${table}`).all()), /a@gmail\.com/, table);
	}
	assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM marketing_suppressions").get().n, 1);
	assert.deepEqual(await recipients(), []);
	assert.equal((await add(["a@gmail.com"])).added, 1);
	assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM marketing_suppressions").get().n, 0);
	assert.deepEqual(await recipients(), ["a@gmail.com"]);
});

test("erasing does not lift an unsubscribe", async () => {
	const { db, add, find } = await setup();
	await add(["a@gmail.com"]);
	const { id } = await find("a@gmail.com");
	await store.unsubscribeAll(db, id, "um clique");
	await store.eraseContact(db, id);
	assert.equal((await add(["a@gmail.com"])).rejected.length, 1);
});

test("C1: filters by list, tag, status and search; large imports stay within D1 limits", async () => {
	const { db, list, add } = await setup();
	await add(Array.from({ length: 200 }, (_, i) => `p${i}@gmail.com`), { tags: ["lote"] });
	assert.equal((await store.listContacts(db, { listId: list.id, tag: "lote", status: "subscribed" })).total, 200);
	assert.equal((await store.listContacts(db, { q: "p19%" })).total, 0);
	assert.equal((await store.listContacts(db, { limit: 500 })).contacts.length, 200);
});

test("C5: marketing never reads the mailbox database", () => {
	for (const file of readdirSync(join(root, "src/lib/marketing"))) {
		assert.doesNotMatch(readFileSync(join(root, "src/lib/marketing", file), "utf8"), /@\/db\b|env\.DB\b|@\/lib\/contacts\/(?!google-csv)/, file);
	}
});

test("unsubscribe links are signed and carry no address", async () => {
	const db = database();
	const secret = await links.getSigningSecret(db);
	assert.equal(await links.getSigningSecret(db), secret);
	const token = await links.createUnsubscribeToken(secret, "con_abc");
	assert.equal(await links.readUnsubscribeToken(secret, token), "con_abc");
	assert.equal(await links.readUnsubscribeToken(secret, token.replace("con_abc", "con_abd")), null);
	assert.equal(await links.readUnsubscribeToken(secret, "con_abc"), null);
	assert.deepEqual(links.unsubscribeHeaders("https://a.test/u/t"), { "List-Unsubscribe": "<https://a.test/u/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

test("U1: a marketing message cannot be built without the unsubscribe link", () => {
	const design = { accent: "#0b57d0", preheader: "", blocks: [], footer: { company: "A", contact: "b", disclaimer: "c" } };
	assert.throws(() => render.renderMarketingEmail(design, "Oi", {}, ""));
	const message = render.renderMarketingEmail(design, "Oi {{nome|cliente}}", {}, "https://a.test/u/t");
	assert.equal(message.subject, "Oi cliente");
	assert.match(message.html, /href="https:\/\/a\.test\/u\/t"[^>]*>Descadastre-se aqui/);
	assert.match(message.text, /Descadastre-se aqui: https:\/\/a\.test\/u\/t/);
	assert.ok(message.headers["List-Unsubscribe-Post"]);
});

test("CSV reading and splitting", () => {
	const parsed = utils.parseImportCsv("﻿E-mail;Nome;Cidade\r\nana@gmail.com;Ana;Recife\r\n");
	assert.deepEqual(parsed.rows, [{ line: 2, email: "ana@gmail.com", name: "Ana", fields: { cidade: "Recife" } }]);
	assert.ok(utils.parseImportCsv("nome\nAna").error);
	const chunks = utils.chunkImportRows(Array.from({ length: 90 }, (_, i) => ({ email: `a@d${i}.test` })));
	assert.deepEqual(chunks.map((chunk) => chunk.length), [40, 40, 10]);
	assert.equal(utils.readConsent({ source: "x", text: "y", date: "2999-01-01" }), null);
});

test("domain check: null MX and unknown domains are refused, lookup failures too", async () => {
	assert.equal(await domains.checkMailDomain("gmail.com", async () => { throw new Error("no lookup"); }), null);
	assert.equal(await domains.checkMailDomain("a.test", async () => ["10 mx.a.test."]), null);
	assert.ok(await domains.checkMailDomain("a.test", async () => ["0 ."]));
	assert.ok(await domains.checkMailDomain("a.test", async () => []));
	assert.ok(await domains.checkMailDomain("a.test", async () => { throw new Error("down"); }));
});
