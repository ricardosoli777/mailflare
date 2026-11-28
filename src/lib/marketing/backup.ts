/**
 * Daily copy of MARKETING_DB into object storage, and its restore. The app's own backup covers only
 * the mail database.
 *
 * The file is gzipped lines of JSON: a header, then one line per row. Restoring only adds what is
 * missing. It never overwrites or deletes, so an old file cannot undo an unsubscribe or an erasure.
 */
export const BACKUP_PREFIX = "marketing-backups/";
export const BACKUPS_KEPT = 30;
const FORMAT = "maillead-marketing-backup";
const NAME = /^maillead-marketing-[0-9TZ-]+\.ndjson\.gz$/;
const PAGE = 2000;
const CHUNK = 400_000;

/**
 * Every table, in restore order: blocks first, and what was already sent or walked before the
 * people, so nobody is queued again while a restore is half done.
 */
export const BACKUP_TABLES = [
	"marketing_settings", "marketing_suppressions", "marketing_templates", "marketing_assets", "marketing_audio", "marketing_lists",
	"marketing_campaigns", "marketing_sends", "marketing_flows", "marketing_flow_runs", "marketing_whatsapp_sends", "marketing_contacts", "marketing_whatsapp",
	"marketing_consents", "marketing_contact_tags", "marketing_list_members", "marketing_events",
	"marketing_forms", "marketing_pending", "marketing_api_keys", "marketing_hooks",
] as const;

type Table = (typeof BACKUP_TABLES)[number];
type Row = Record<string, string | number | null>;

export type BackupFile = { name: string; size: number; createdAt: number };

export const isBackupName = (name: unknown): name is string => typeof name === "string" && NAME.test(name);

export async function createBackup(db: D1Database, now = Date.now()): Promise<Uint8Array> {
	const gzip = new CompressionStream("gzip");
	const output = new Response(gzip.readable).arrayBuffer();
	const writer = gzip.writable.getWriter();
	const encoder = new TextEncoder();
	const write = (text: string) => writer.write(encoder.encode(text));
	await write(`${JSON.stringify({ format: FORMAT, version: 1, createdAt: new Date(now).toISOString() })}\n`);
	for (const table of BACKUP_TABLES) {
		let after = 0;
		for (;;) {
			const { results } = await db.prepare(`SELECT rowid AS _rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`).bind(after).all<Row>();
			if (!results.length) break;
			after = Number(results.at(-1)!._rowid);
			// The WhatsApp token is a credential to another server: it is typed again, never copied.
			await write(results.filter((row) => !(table === "marketing_settings" && row.key === "whatsapp")).map(({ _rowid, ...row }) => `${JSON.stringify({ t: table, r: row })}\n`).join(""));
			if (results.length < PAGE) break;
		}
	}
	await writer.close();
	return new Uint8Array(await output);
}

export async function listBackupFiles(bucket: R2Bucket): Promise<BackupFile[]> {
	const { objects } = await bucket.list({ prefix: BACKUP_PREFIX, limit: 200 });
	return objects
		.map((object) => ({ name: object.key.slice(BACKUP_PREFIX.length), size: object.size, createdAt: object.uploaded.getTime() }))
		.filter((file) => isBackupName(file.name))
		.sort((a, b) => b.name.localeCompare(a.name));
}

/** Writes today's copy and drops the ones beyond the newest thirty. */
export async function saveBackup(db: D1Database, bucket: R2Bucket, now = Date.now()): Promise<string> {
	const name = `maillead-marketing-${new Date(now).toISOString().slice(0, 19).replace(/:/g, "")}Z.ndjson.gz`;
	await bucket.put(BACKUP_PREFIX + name, await createBackup(db, now), { httpMetadata: { contentType: "application/gzip" } });
	const old = (await listBackupFiles(bucket)).slice(BACKUPS_KEPT);
	if (old.length) await bucket.delete(old.map((file) => BACKUP_PREFIX + file.name));
	return name;
}

async function* lines(file: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = file.pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
	const decoder = new TextDecoder();
	let rest = "";
	for (;;) {
		const { value, done } = await reader.read();
		rest += done ? decoder.decode() : decoder.decode(value, { stream: true });
		const parts = rest.split("\n");
		rest = parts.pop()!;
		yield* parts;
		if (done) break;
	}
	if (rest) yield rest;
}

/** Nothing restored may send by itself: queued mail is dropped, and what was running comes back paused. */
function calm(table: Table, row: Row): Row {
	if (table === "marketing_sends" && (row.status === "pending" || row.status === "sending")) return { ...row, status: "skipped", error: "restaurado de backup" };
	if (table === "marketing_campaigns" && (row.status === "running" || row.status === "scheduled")) return { ...row, status: "paused" };
	if (table === "marketing_whatsapp_sends" && row.status === "sending") return { ...row, status: "failed", error: "restaurado de backup" };
	if (table === "marketing_flows" && row.status === "active") return { ...row, status: "paused" };
	return row;
}

const count = async (db: D1Database, table: Table) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

export class BackupError extends Error {}

/** Adds what the file has and the database lacks. Returns how many rows came back, per table. */
export async function restoreBackup(db: D1Database, file: ReadableStream<Uint8Array>): Promise<Partial<Record<Table, number>>> {
	const restored: Partial<Record<Table, number>> = {};
	// Revoked keys and webhooks must not come back to life, so these return only to an empty table.
	const skip = new Set<Table>();
	for (const table of ["marketing_api_keys", "marketing_hooks"] as const) if (await count(db, table)) skip.add(table);
	// A database that never sent has no links out there, so the file's signing secret is the one that counts.
	const takeSecret = !(await count(db, "marketing_sends"));
	const columns = new Map<Table, string[]>();
	let table: Table | null = null;
	let chunk: Row[] = [];
	let size = 0;

	const flush = async () => {
		if (!table || !chunk.length) return;
		if (!columns.has(table)) columns.set(table, (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((column) => column.name));
		// Only columns this version knows; the rest take their defaults.
		const names = columns.get(table)!.filter((name) => name in chunk[0]);
		const insert = (rows: Row[], how: "IGNORE" | "REPLACE") => db.prepare(`INSERT OR ${how} INTO ${table} (${names.join(", ")}) SELECT ${names.map((name) => `json_extract(value, '$.${name}')`).join(", ")} FROM json_each(?1)`).bind(JSON.stringify(rows)).run();
		const { meta } = await insert(chunk, "IGNORE");
		restored[table] = (restored[table] ?? 0) + meta.changes;
		if (takeSecret && table === "marketing_settings") {
			const secret = chunk.filter((row) => row.key === "unsubscribe_secret");
			if (secret.length) await insert(secret, "REPLACE");
		}
		chunk = [];
		size = 0;
	};

	let header = false;
	try {
		for await (const line of lines(file)) {
			if (!line) continue;
			const value = JSON.parse(line) as { format?: string; version?: number; t?: Table; r?: Row };
			if (!header) {
				if (value.format !== FORMAT || value.version !== 1) throw new BackupError("Este arquivo não é um backup do marketing.");
				header = true;
				continue;
			}
			if (!value.t || !value.r || !BACKUP_TABLES.includes(value.t) || skip.has(value.t)) continue;
			if (value.t !== table || size > CHUNK) await flush();
			table = value.t;
			chunk.push(calm(value.t, value.r));
			size += line.length;
		}
		await flush();
	} catch (error) {
		if (error instanceof BackupError) throw error;
		throw new BackupError("Não foi possível ler o arquivo. Ele pode estar incompleto ou corrompido.");
	}
	if (!header) throw new BackupError("Este arquivo não é um backup do marketing.");
	await enforceErasure(db);
	return restored;
}

/** Whoever asked to be erased stays erased, and rows left without their contact or list are dropped. */
async function enforceErasure(db: D1Database): Promise<void> {
	const erased = "SELECT c.id FROM marketing_contacts c JOIN marketing_suppressions s ON s.email_hash = c.email_hash WHERE s.reason = 'erased'";
	await db.batch([
		// Someone added again after being erased is a new registration: the old mark no longer applies.
		db.prepare("DELETE FROM marketing_suppressions WHERE reason = 'erased' AND EXISTS (SELECT 1 FROM marketing_contacts c WHERE c.email_hash = marketing_suppressions.email_hash AND c.created_at > marketing_suppressions.created_at)"),
		db.prepare(`DELETE FROM marketing_pending WHERE email IN (SELECT email FROM marketing_contacts WHERE id IN (${erased}))`),
		db.prepare(`DELETE FROM marketing_contacts WHERE id IN (${erased})`),
		...["marketing_consents", "marketing_events", "marketing_list_members", "marketing_contact_tags", "marketing_flow_runs", "marketing_whatsapp", "marketing_whatsapp_sends"]
			.map((name) => db.prepare(`DELETE FROM ${name} WHERE contact_id NOT IN (SELECT id FROM marketing_contacts)`)),
		db.prepare("DELETE FROM marketing_list_members WHERE list_id NOT IN (SELECT id FROM marketing_lists)"),
	]);
}
