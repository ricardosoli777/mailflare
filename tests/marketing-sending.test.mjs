import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "maillead-sending-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({ entryPoints: [join(root, entry)], outfile: join(outDir, outfile), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent", alias: { "@": join(root, "src") } });
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const store = await bundle("src/lib/marketing/contacts.ts", "contacts.mjs");
const engine = await bundle("src/lib/marketing/engine.ts", "engine.mjs");
const campaigns = await bundle("src/lib/marketing/campaigns.ts", "campaigns.mjs");
const tracking = await bundle("src/lib/marketing/tracking.ts", "tracking.mjs");
const checks = await bundle("src/lib/marketing/campaign-checks.ts", "checks.mjs");
const utils = await bundle("src/lib/marketing/sending-utils.ts", "utils.mjs");
const feedback = await bundle("src/lib/marketing/feedback.ts", "feedback.mjs");

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

const design = { accent: "#0b57d0", preheader: "", blocks: [{ type: "text", text: "Olá {{nome|cliente}}" }], footer: { company: "KLEAD", contact: "contato@klead.com.br", disclaimer: "Você se cadastrou." } };
const NOW = Date.parse("2026-11-26T12:00:00Z");
const settings = { fromName: "KLEAD", fromEmail: "contato@news.klead.com.br", replyTo: "", origin: "https://mail.klead.com.br", hourlyByProvider: { gmail: 1000, outlook: 1000, yahoo: 1000, other: 1000 } };
const quota = { max24Hour: 50000, maxPerSecond: 14, sentLast24Hours: 0, sendingEnabled: true };

async function setup(count = 3, { domain = "gmail.com", warmupDaysAgo = 0 } = {}) {
	const db = database();
	const list = await store.createMailingList(db, "Clientes");
	const consent = { source: "compra", text: "Aceito", consentedAt: NOW };
	const rows = Array.from({ length: count }, (_, index) => ({ line: index + 2, email: `p${index}@${domain}`, name: "", fields: {} }));
	await store.importContacts(db, rows, { listId: list.id, consent, origin: "teste" });
	await engine.writeSetting(db, "sender", settings);
	if (warmupDaysAgo) await engine.writeSetting(db, "warmup_started_at", NOW - warmupDaysAgo * 86400000);
	const campaign = await campaigns.createCampaign(db, { name: "Novidades", listId: list.id, subject: "Oi {{nome|cliente}}", design }, NOW);
	const sent = [];
	const deps = {
		quota: async () => quota,
		send: async (message) => {
			sent.push(message);
			return { messageId: `ses-${sent.length}` };
		},
		now: () => NOW,
		sleep: async () => {},
	};
	const statuses = () => Object.fromEntries(db.sqlite.prepare("SELECT status, COUNT(*) AS n FROM marketing_sends GROUP BY status").all().map((row) => [row.status, row.n]));
	return { db, list, campaign, sent, deps, statuses };
}

test("K2: running again, even at the same time, never sends twice", async () => {
	const { db, campaign, sent, deps, statuses } = await setup(5);
	assert.equal(campaign.queued, 5);
	await Promise.all([engine.runEngine(db, deps), engine.runEngine(db, deps)]);
	await engine.runEngine(db, deps);
	assert.equal(sent.length, 5);
	assert.equal(new Set(sent.map((message) => message.to)).size, 5);
	assert.deepEqual(statuses(), { sent: 5 });
	assert.equal(db.sqlite.prepare("SELECT status FROM marketing_campaigns").get().status, "done");
});

test("every message carries unsubscribe link and headers", async () => {
	const { db, sent, deps } = await setup(1);
	await engine.runEngine(db, deps);
	const [message] = sent;
	assert.match(message.headers["List-Unsubscribe"], /^<https:\/\/mail\.klead\.com\.br\/api\/marketing\/u\/[^>]+>$/);
	assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
	assert.match(message.html, /Descadastre-se aqui/);
	assert.equal(message.subject, "Oi cliente");
	assert.equal(message.from, '"KLEAD" <contato@news.klead.com.br>');
});

test("U3: unsubscribing while queued stops the message", async () => {
	const { db, sent, deps, statuses } = await setup(3);
	const [first] = (await store.listContacts(db, { q: "p0@" })).contacts;
	await store.unsubscribeAll(db, first.id, "um clique");
	await engine.runEngine(db, deps);
	assert.equal(sent.length, 2);
	assert.deepEqual(statuses(), { sent: 2, skipped: 1 });
});

test("an AWS review or pause stops the engine", async () => {
	const { db, sent, deps } = await setup(1);
	const run = await engine.runEngine(db, { ...deps, quota: async () => ({ ...quota, enforcement: "PROBATION" }) });
	assert.match(run.blocked, /PROBATION/);
	assert.equal(sent.length, 0);
});

test("R4/R3: warm-up and the AWS quota cap the day", async () => {
	const first = await setup(80);
	await engine.runEngine(first.db, first.deps, 200);
	assert.equal(first.sent.length, 50);
	const again = await engine.runEngine(first.db, first.deps, 200);
	assert.match(again.blocked, /Limite diário/);
	assert.equal(first.sent.length, 50);

	const tight = await setup(10);
	await engine.runEngine(tight.db, { ...tight.deps, quota: async () => ({ ...quota, max24Hour: 200, sentLast24Hours: 196 }) });
	assert.equal(tight.sent.length, 4);
	assert.deepEqual([utils.warmupLimit(1), utils.warmupLimit(4), utils.warmupLimit(8), utils.warmupLimit(22), utils.warmupLimit(31), utils.warmupLimit(38)], [50, 150, 500, 2000, 2600, 3380]);
});

test("R10: one provider at its hourly pace does not hold back the others", async () => {
	const { db, sent, deps } = await setup(4);
	await engine.writeSetting(db, "sender", { ...settings, hourlyByProvider: { ...settings.hourlyByProvider, gmail: 1 } });
	await engine.runEngine(db, deps);
	await engine.runEngine(db, deps);
	assert.equal(sent.length, 1);
});

test("R5: the breaker pauses a simulated send and stays open until reset", async () => {
	const { db, sent, deps, statuses } = await setup(120, { warmupDaysAgo: 10 });
	const bounce = (messageId, email) => feedback.recordSesEvent(db, JSON.stringify({ eventType: "Bounce", mail: { messageId }, bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: email }] } }), NOW);
	let late;
	const run = await engine.runEngine(db, {
		...deps,
		send: async (message) => {
			// Events arrive after the send is recorded; here, when the next one starts.
			if (late) await bounce(...late);
			const sentMessage = await deps.send(message);
			// Every fifth address bounces, far above the 2% limit.
			late = sent.length % 5 === 0 ? [sentMessage.messageId, message.to] : null;
			return sentMessage;
		},
	}, 120);
	assert.match(run.blocked, /Devoluções/);
	assert.equal(sent.length, 50);
	assert.equal(statuses().pending, 70);
	assert.match((await engine.runEngine(db, deps, 120)).blocked, /Devoluções/);
	assert.equal(sent.length, 50);
	await engine.resetBreaker(db, NOW + 1);
	await engine.runEngine(db, { ...deps, now: () => NOW + 2 }, 120);
	assert.equal(sent.length, 120);
});

test("an uncertain failure is not retried; throttling is", async () => {
	const lost = await setup(1);
	await engine.runEngine(lost.db, { ...lost.deps, send: async () => { throw new Error("network"); } });
	await engine.runEngine(lost.db, lost.deps);
	assert.equal(lost.sent.length, 0);
	assert.deepEqual(lost.statuses(), { unknown: 1 });

	const slow = await setup(2);
	const run = await engine.runEngine(slow.db, { ...slow.deps, send: async () => { throw Object.assign(new Error("slow down"), { status: 429, code: "TooManyRequestsException" }); } });
	assert.match(run.blocked, /recusou/);
	assert.deepEqual(slow.statuses(), { pending: 2 });
	await engine.runEngine(slow.db, slow.deps);
	assert.equal(slow.sent.length, 2);

	const stale = await setup(1);
	stale.db.sqlite.exec(`UPDATE marketing_sends SET status = 'sending', claimed_at = ${NOW - 3600000}`);
	await engine.runEngine(stale.db, stale.deps);
	assert.equal(stale.sent.length, 0);
	assert.deepEqual(stale.statuses(), { unknown: 1 });
});

test("U5: permanent bounce and complaint block the address; a soft bounce does not", async () => {
	const { db, list, deps } = await setup(3);
	await engine.runEngine(db, deps);
	const rows = db.sqlite.prepare("SELECT s.message_id, c.email FROM marketing_sends s JOIN marketing_contacts c ON c.id = s.contact_id ORDER BY c.email").all();
	const event = (payload) => feedback.recordSesEvent(db, JSON.stringify(payload), NOW);
	await event({ eventType: "Bounce", mail: { messageId: rows[0].message_id }, bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: rows[0].email }] } });
	await event({ eventType: "Complaint", mail: { messageId: rows[1].message_id }, complaint: { complainedRecipients: [{ emailAddress: rows[1].email }] } });
	await event({ eventType: "Bounce", mail: { messageId: rows[2].message_id }, bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: rows[2].email }] } });
	await event({ eventType: "Delivery", mail: { messageId: rows[2].message_id }, delivery: {} });
	assert.deepEqual((await store.eligibleRecipients(db, list.id)).map((item) => item.email), [rows[2].email]);
	const counts = db.sqlite.prepare("SELECT COUNT(bounced_at) AS b, COUNT(complained_at) AS c, COUNT(delivered_at) AS d FROM marketing_sends").get();
	assert.deepEqual({ ...counts }, { b: 1, c: 1, d: 1 });
});

test("sender settings and provider detection", async () => {
	assert.ok("error" in utils.readSenderSettings({ ...settings, origin: "http://x" }));
	assert.ok("settings" in utils.readSenderSettings(settings));
	assert.match(utils.formatFrom("Informações", "a@b.com"), /^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
	for (const [domain, provider] of [["hotmail.com.br", "outlook"], ["yahoo.com.br", "yahoo"], ["empresa.com", "other"]]) {
		const { db } = await setup(1, { domain });
		assert.equal(db.sqlite.prepare("SELECT provider FROM marketing_sends").get().provider, provider);
	}
});

test("load: 2,000 recipients queue once and drain without repeats", async () => {
	const { db, sent, deps, statuses } = await setup(2000, { warmupDaysAgo: 400 });
	for (let run = 0; run < 100 && statuses().pending; run++) {
		const result = await engine.runEngine(db, { ...deps, quota: async () => ({ ...quota, max24Hour: 1000000 }) }, 500);
		if (result.blocked) await engine.writeSetting(db, "sender", settings);
		db.sqlite.exec("UPDATE marketing_sends SET sent_at = 1 WHERE sent_at IS NOT NULL");
	}
	assert.equal(sent.length, 2000);
	assert.equal(new Set(sent.map((message) => message.to)).size, 2000);
});

test("the SNS certificate fetch uses only options Workers accept", () => {
	assert.doesNotMatch(readFileSync(join(root, "src/lib/aws/sns-signature.ts"), "utf8"), /redirect: "error",/);
});

const report = async (db, id) => (await campaigns.listCampaigns(db)).find((item) => item.id === id);

test("K1: scheduled waits for its time; pause and cancel stop the rest", async () => {
	const { db, list, sent, deps } = await setup(0);
	await store.importContacts(db, [0, 1, 2].map((index) => ({ line: index + 2, email: `s${index}@gmail.com`, name: "", fields: {} })), { listId: list.id, consent: { source: "x", text: "y", consentedAt: NOW }, origin: "teste" });
	const later = await campaigns.createCampaign(db, { name: "Depois", listId: list.id, subject: "Oi", design, scheduledAt: NOW + 3600000 }, NOW);
	assert.equal(later.queued, 0);
	await engine.runEngine(db, deps);
	assert.equal(sent.length, 0);
	await campaigns.changeCampaign(db, later.id, "pause");
	await engine.runEngine(db, { ...deps, now: () => NOW + 7200000 });
	assert.equal(sent.length, 0);
	await campaigns.changeCampaign(db, later.id, "resume");
	// Paused in the middle of a batch: what was not claimed stays.
	await engine.runEngine(db, {
		...deps,
		now: () => NOW + 7200000,
		send: async (message) => {
			const result = await deps.send(message);
			await campaigns.changeCampaign(db, later.id, "pause");
			return result;
		},
	});
	assert.equal(sent.length, 1);
	assert.equal(await campaigns.changeCampaign(db, later.id, "cancel"), true);
	assert.equal(await campaigns.changeCampaign(db, later.id, "resume"), false);
	await engine.runEngine(db, { ...deps, now: () => NOW + 9000000 });
	assert.equal(sent.length, 1);
	const numbers = await report(db, later.id);
	assert.deepEqual([numbers.status, numbers.total, numbers.sent, numbers.skipped, numbers.pending], ["cancelled", 3, 1, 2, 0]);
});

test("segment by tag, weekly limit and inactive people", async () => {
	const { db, list, sent, deps } = await setup(2);
	await engine.runEngine(db, deps);
	await store.importContacts(db, [{ line: 2, email: "vip@gmail.com", name: "", fields: {} }], { listId: list.id, consent: { source: "x", text: "y", consentedAt: NOW }, tags: ["vip"], origin: "teste" });
	assert.equal((await campaigns.createCampaign(db, { name: "VIP", listId: list.id, subject: "Oi", design, tag: "vip" }, NOW)).queued, 1);
	await engine.runEngine(db, deps);

	await engine.writeSetting(db, "sender", { ...settings, weeklyLimit: 1 });
	await campaigns.createCampaign(db, { name: "Outra", listId: list.id, subject: "Oi", design }, NOW);
	const before = sent.length;
	await engine.runEngine(db, deps);
	assert.equal(sent.length, before);

	// 200 days later, silent people are left out unless asked for; a click keeps someone active.
	const later = NOW + 200 * 86400000;
	const one = db.sqlite.prepare("SELECT id FROM marketing_sends WHERE sent_at IS NOT NULL LIMIT 1").get();
	await tracking.recordClick(db, one.id, later - 1000);
	assert.deepEqual({ ...(await campaigns.countAudience(db, list.id, "", later)) }, { total: 3, inactive: 2 });
	assert.equal((await campaigns.createCampaign(db, { name: "Ativos", listId: list.id, subject: "Oi", design }, later)).queued, 1);
	assert.equal((await campaigns.createCampaign(db, { name: "Todos", listId: list.id, subject: "Oi", design, includeInactive: true }, later)).queued, 3);
});

test("K3: opens, clicks and unsubscribes are counted; only signed links redirect", async () => {
	const { db, list, sent, deps } = await setup(0);
	await store.importContacts(db, [{ line: 2, email: "a@gmail.com", name: "", fields: {} }], { listId: list.id, consent: { source: "x", text: "y", consentedAt: NOW }, origin: "teste" });
	const withLink = { ...design, blocks: [{ type: "button", label: "Ver", url: "https://klead.com.br/oferta?a=1&b=2" }] };
	const { id } = await campaigns.createCampaign(db, { name: "Links", listId: list.id, subject: "Oi", design: withLink }, NOW);
	await engine.runEngine(db, deps);
	const [{ html, headers }] = sent;
	const click = new URL(/href="(https:\/\/mail\.klead\.com\.br\/api\/marketing\/c\/[^"]+)"/.exec(html)[1].replace(/&amp;/g, "&"));
	const token = click.pathname.split("/").pop();
	const destination = click.searchParams.get("u");
	assert.equal(destination, "https://klead.com.br/oferta?a=1&b=2");
	const secret = db.sqlite.prepare("SELECT value FROM marketing_settings WHERE key = 'unsubscribe_secret'").get().value;
	const sendId = await tracking.readClickToken(secret, token, destination);
	assert.ok(sendId);
	assert.equal(await tracking.readClickToken(secret, token, "https://golpe.example"), null);
	// The unsubscribe link is never rewritten, and carries the campaign for the report.
	assert.match(headers["List-Unsubscribe"], new RegExp(`/api/marketing/u/[^?]+\\?c=${id}>$`));
	assert.match(html, /href="https:\/\/mail\.klead\.com\.br\/api\/marketing\/u\//);
	const open = /<img src="https:\/\/mail\.klead\.com\.br\/api\/marketing\/o\/([^"]+)"/.exec(html)[1];
	assert.equal(await tracking.readOpenToken(secret, open), sendId);
	assert.equal(await tracking.readOpenToken(secret, `${sendId}.x`), null);
	await tracking.recordClick(db, sendId, NOW);
	const contact = (await store.listContacts(db, { q: "a@" })).contacts[0];
	await campaigns.markUnsubscribed(db, contact.id, id, NOW);
	const numbers = await report(db, id);
	assert.deepEqual([numbers.sent, numbers.opened, numbers.clicked, numbers.unsubscribed], [1, 1, 1, 1]);
});

test("erasing a queued contact does not leave the campaign stuck", async () => {
	const { db, campaign, sent, deps } = await setup(2);
	const [first] = (await store.listContacts(db, { q: "p0@" })).contacts;
	await store.eraseContact(db, first.id);
	await engine.runEngine(db, deps);
	await engine.runEngine(db, deps);
	assert.equal(sent.length, 1);
	assert.equal((await report(db, campaign.id)).status, "done");
});

test("R9: warnings about subject, images, weight and dead links", async () => {
	assert.equal(checks.contentWarnings("Novidades de novembro", "<p>oi</p>", "um texto normal").length, 0);
	assert.equal(checks.contentWarnings("PROMOÇÃO IMPERDÍVEL!!", `<img src="a">${"x".repeat(110000)}`, "oi").length, 4);
	assert.deepEqual(checks.extractLinks('<a href="https://a.com/?x=1&amp;y=2">a</a><a href="https://a.com/?x=1&amp;y=2">b</a>'), ["https://a.com/?x=1&y=2"]);
	const answer = async (url) => ({ status: url.includes("missing") ? 404 : 200 });
	assert.deepEqual(await checks.linkWarnings(["https://a.com/ok", "https://a.com/missing"], answer), ["Link com erro 404: https://a.com/missing"]);
});
