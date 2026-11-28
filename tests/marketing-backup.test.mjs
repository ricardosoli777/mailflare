import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "maillead-backup-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({ entryPoints: [join(root, entry)], outfile: join(outDir, outfile), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent", alias: { "@": join(root, "src") } });
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const backup = await bundle("src/lib/marketing/backup.ts", "backup.mjs");
const store = await bundle("src/lib/marketing/contacts.ts", "contacts.mjs");

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

function bucket() {
	const objects = new Map();
	return {
		objects,
		put: async (key, value) => void objects.set(key, value),
		list: async ({ prefix }) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.length, uploaded: new Date() })) }),
		delete: async (keys) => [keys].flat().forEach((key) => objects.delete(key)),
	};
}

const NOW = Date.parse("2026-11-26T02:00:00Z");
const stream = (bytes) => new Blob([bytes]).stream();
const all = (db, table) => db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }));
const one = (db, sql) => db.sqlite.prepare(sql).get();

async function filled() {
	const db = database();
	const list = await store.createMailingList(db, "Clientes");
	for (const [index, email] of ["ana@gmail.com", "bia@gmail.com"].entries()) {
		await store.importContacts(db, [{ line: 1, email, name: "Maria da Conceição \"Mãe\"\nlinha", fields: { cidade: "São Paulo" } }], { listId: list.id, consent: { source: "teste", text: "aceito", consentedAt: NOW }, tags: [`t${index}`], origin: "teste", now: NOW });
	}
	db.sqlite.exec(`INSERT INTO marketing_settings VALUES ('unsubscribe_secret', 'segredo-original');
		INSERT INTO marketing_campaigns (id, name, list_id, subject, design, status, created_at) VALUES ('cmp', 'Promo', 'l', 'Oi', '{}', 'running', 1);
		INSERT INTO marketing_sends (id, campaign_id, contact_id, provider, status) SELECT 'snd' || id, 'cmp', id, 'gmail', 'pending' FROM marketing_contacts;
		INSERT INTO marketing_flows (id, name, list_id, status, created_at) VALUES ('flw', 'Funil', 'l', 'active', 1);
		INSERT INTO marketing_api_keys (id, name, key_hash, created_at) VALUES ('key', 'site', 'hash', 1);`);
	return { db, list };
}

test("every marketing table is in the backup", () => {
	const db = database();
	const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
	assert.deepEqual([...backup.BACKUP_TABLES].sort(), tables.sort());
});

test("an empty database gets everything back, and nothing restored sends by itself", async () => {
	const { db } = await filled();
	db.sqlite.exec(`INSERT INTO marketing_settings VALUES ('whatsapp', '{"token":"segredo"}')`);
	const file = await backup.createBackup(db, NOW);
	const empty = database();
	// A fresh install may already have made its own secret.
	empty.sqlite.exec("INSERT INTO marketing_settings VALUES ('unsubscribe_secret', 'novo')");
	const restored = await backup.restoreBackup(empty, stream(file));
	assert.equal(restored.marketing_contacts, 2);
	assert.equal(one(empty, "SELECT COUNT(*) AS n FROM marketing_settings WHERE key = 'whatsapp'").n, 0);
	for (const table of ["marketing_contacts", "marketing_consents", "marketing_list_members", "marketing_contact_tags", "marketing_lists", "marketing_api_keys"]) {
		assert.deepEqual(all(empty, table), all(db, table), table);
	}
	assert.equal(one(empty, "SELECT value FROM marketing_settings WHERE key = 'unsubscribe_secret'").value, "segredo-original");
	assert.equal(one(empty, "SELECT COUNT(*) AS n FROM marketing_sends WHERE status = 'skipped'").n, 2);
	assert.equal(one(empty, "SELECT status FROM marketing_campaigns").status, "paused");
	assert.equal(one(empty, "SELECT status FROM marketing_flows").status, "paused");
});

test("an old file never undoes an unsubscribe, an erasure or a revoked key", async () => {
	const { db, list } = await filled();
	const file = await backup.createBackup(db, NOW);
	const id = (email) => one(db, `SELECT id FROM marketing_contacts WHERE email = '${email}'`).id;
	const [ana, bia] = [id("ana@gmail.com"), id("bia@gmail.com")];
	await store.unsubscribeAll(db, ana, "teste", NOW + 1);
	db.sqlite.prepare("UPDATE marketing_list_members SET unsubscribed_at = ? WHERE contact_id = ?").run(NOW + 1, ana);
	await store.eraseContact(db, bia, NOW + 2);
	db.sqlite.exec("DELETE FROM marketing_api_keys; INSERT INTO marketing_api_keys (id, name, key_hash, created_at) VALUES ('nova', 'n', 'h2', 2); UPDATE marketing_flows SET status = 'draft'");

	await backup.restoreBackup(db, stream(file));
	assert.deepEqual(all(db, "marketing_contacts").map((row) => row.email), ["ana@gmail.com"]);
	assert.equal(one(db, "SELECT unsubscribed_at FROM marketing_list_members").unsubscribed_at, NOW + 1);
	assert.equal(one(db, "SELECT COUNT(*) AS n FROM marketing_suppressions").n, 2);
	assert.equal(one(db, `SELECT COUNT(*) AS n FROM marketing_consents WHERE contact_id = '${bia}'`).n, 0);
	assert.deepEqual(all(db, "marketing_api_keys").map((row) => row.id), ["nova"]);
	assert.equal(one(db, "SELECT status FROM marketing_flows").status, "draft", "what exists is not replaced");
	assert.equal(one(db, "SELECT COUNT(*) AS n FROM marketing_lists").n, 1);
	assert.ok(list);
});

test("large tables come back whole, and bad files are refused", async () => {
	const db = database();
	const insert = db.sqlite.prepare("INSERT INTO marketing_sends (id, campaign_id, contact_id, provider, status, error) VALUES (?, 'c', ?, 'gmail', 'sent', ?)");
	for (let index = 0; index < 4500; index++) insert.run(`s${index}`, `k${index}`, "x".repeat(200));
	const copy = database();
	assert.equal((await backup.restoreBackup(copy, stream(await backup.createBackup(db, NOW)))).marketing_sends, 4500);

	await assert.rejects(backup.restoreBackup(copy, stream("isto não é um backup")), backup.BackupError);
	const other = await new Response(new Blob(['{"format":"outro"}\n']).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
	await assert.rejects(backup.restoreBackup(copy, stream(other)), /não é um backup/);
});

test("the newest thirty copies are kept", async () => {
	const db = database();
	const files = bucket();
	for (let day = 0; day < backup.BACKUPS_KEPT + 3; day++) await backup.saveBackup(db, files, NOW + day * 86_400_000);
	const kept = await backup.listBackupFiles(files);
	assert.equal(kept.length, backup.BACKUPS_KEPT);
	assert.ok(backup.isBackupName(kept[0].name));
	assert.ok(kept[0].name > kept.at(-1).name);
	assert.equal(backup.isBackupName("../segredo"), false);
});

test("someone added again after being erased survives a restore made while erased", async () => {
	const { db } = await filled();
	const { id, email } = one(db, "SELECT id, email FROM marketing_contacts WHERE email = 'bia@gmail.com'");
	await store.eraseContact(db, id, NOW + 1);
	const file = await backup.createBackup(db, NOW + 2);
	await store.importContacts(db, [{ line: 1, email, name: "", fields: {} }], { listId: null, consent: null, origin: "teste", now: NOW + 3 });
	await backup.restoreBackup(db, stream(file));
	assert.ok(one(db, "SELECT 1 AS ok FROM marketing_contacts WHERE email = 'bia@gmail.com'"));
	assert.equal(one(db, "SELECT count(*) AS n FROM marketing_suppressions").n, 0);
});
