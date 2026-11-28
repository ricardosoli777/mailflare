/**
 * Contact storage in MARKETING_DB. Nothing here reads the mail database: people in a mailbox
 * never become marketing contacts on their own (C5).
 */
import { newId } from "@/lib/ids";
import { domainOf, emailHash, isValidEmail, normalizeEmail, isRoleAddress, ROLE_ADDRESS_REASON } from "./contacts-utils";
import type { Consent, ContactDetail, ContactStatus, ContactSummary, ImportReport, ImportRow, MailingList } from "./contacts-types";

type ContactRow = { id: string; email: string; name: string; fields: string; created_at: number; reason: string | null; consents: number };

const marks = (count: number) => Array(count).fill("?").join(", ");
const chunk = <T>(items: T[], size = 90): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
	for (const group of chunk(statements, 100)) await db.batch(group);
}

const CONSENTED = "EXISTS (SELECT 1 FROM marketing_consents k WHERE k.contact_id = c.id)";
const SELECT_CONTACT = `SELECT c.id, c.email, c.name, c.fields, c.created_at, s.reason, ${CONSENTED} AS consents
	FROM marketing_contacts c LEFT JOIN marketing_suppressions s ON s.email_hash = c.email_hash`;

const STATUS_SQL: Record<ContactStatus, string> = {
	subscribed: `s.reason IS NULL AND ${CONSENTED}`,
	no_consent: `s.reason IS NULL AND NOT ${CONSENTED}`,
	unsubscribed: "s.reason = 'unsubscribe'",
	blocked: "s.reason IS NOT NULL AND s.reason <> 'unsubscribe'",
};

function statusOf(row: Pick<ContactRow, "reason" | "consents">): ContactStatus {
	if (row.reason) return row.reason === "unsubscribe" ? "unsubscribed" : "blocked";
	return row.consents ? "subscribed" : "no_consent";
}

async function summarize(db: D1Database, rows: ContactRow[]): Promise<ContactSummary[]> {
	const tags = new Map<string, string[]>();
	const lists = new Map<string, ContactSummary["lists"]>();
	for (const ids of chunk(rows.map((row) => row.id))) {
		const tagRows = await db.prepare(`SELECT contact_id, tag FROM marketing_contact_tags WHERE contact_id IN (${marks(ids.length)}) ORDER BY tag`).bind(...ids).all<{ contact_id: string; tag: string }>();
		for (const row of tagRows.results) tags.set(row.contact_id, [...(tags.get(row.contact_id) ?? []), row.tag]);
		const listRows = await db.prepare(`SELECT m.contact_id, l.id, l.name, m.unsubscribed_at FROM marketing_list_members m JOIN marketing_lists l ON l.id = m.list_id WHERE m.contact_id IN (${marks(ids.length)}) ORDER BY l.name`).bind(...ids).all<{ contact_id: string; id: string; name: string; unsubscribed_at: number | null }>();
		for (const row of listRows.results) lists.set(row.contact_id, [...(lists.get(row.contact_id) ?? []), { id: row.id, name: row.name, unsubscribed: row.unsubscribed_at !== null }]);
	}
	return rows.map((row) => ({ id: row.id, email: row.email, name: row.name, status: statusOf(row), tags: tags.get(row.id) ?? [], lists: lists.get(row.id) ?? [], createdAt: row.created_at }));
}

export type ContactFilter = { q?: string; listId?: string; tag?: string; status?: string; limit?: number; offset?: number };

export async function listContacts(db: D1Database, filter: ContactFilter = {}) {
	const where: string[] = [];
	const values: unknown[] = [];
	if (filter.q?.trim()) {
		const pattern = `%${filter.q.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
		where.push("(c.email LIKE ? ESCAPE '\\' OR lower(c.name) LIKE ? ESCAPE '\\')");
		values.push(pattern, pattern);
	}
	if (filter.listId) {
		where.push("EXISTS (SELECT 1 FROM marketing_list_members m WHERE m.contact_id = c.id AND m.list_id = ?)");
		values.push(filter.listId);
	}
	if (filter.tag) {
		where.push("EXISTS (SELECT 1 FROM marketing_contact_tags t WHERE t.contact_id = c.id AND t.tag = ?)");
		values.push(filter.tag.trim().toLowerCase());
	}
	if (filter.status && Object.hasOwn(STATUS_SQL, filter.status)) where.push(STATUS_SQL[filter.status as ContactStatus]);
	const condition = where.length ? ` WHERE ${where.join(" AND ")}` : "";
	const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
	const total = await db.prepare(`SELECT count(*) AS total FROM marketing_contacts c LEFT JOIN marketing_suppressions s ON s.email_hash = c.email_hash${condition}`).bind(...values).first<{ total: number }>();
	const rows = await db.prepare(`${SELECT_CONTACT}${condition} ORDER BY c.created_at DESC, c.id LIMIT ? OFFSET ?`).bind(...values, limit, Math.max(filter.offset ?? 0, 0)).all<ContactRow>();
	return { total: total?.total ?? 0, contacts: await summarize(db, rows.results) };
}

export async function getContact(db: D1Database, id: string): Promise<ContactDetail | null> {
	const row = await db.prepare(`${SELECT_CONTACT} WHERE c.id = ?`).bind(id).first<ContactRow>();
	if (!row) return null;
	const [summary] = await summarize(db, [row]);
	const consents = await db.prepare("SELECT source, text, consented_at AS consentedAt, recorded_at AS recordedAt FROM marketing_consents WHERE contact_id = ? ORDER BY recorded_at").bind(id).all<ContactDetail["consents"][number]>();
	const events = await db.prepare("SELECT type, detail, created_at AS createdAt FROM marketing_events WHERE contact_id = ? ORDER BY created_at DESC LIMIT 200").bind(id).all<ContactDetail["events"][number]>();
	const whatsapp = await db.prepare("SELECT phone, source, text, consented_at AS consentedAt, opted_out_at AS optedOutAt FROM marketing_whatsapp WHERE contact_id = ?").bind(id).first<NonNullable<ContactDetail["whatsapp"]>>();
	return { ...summary, fields: JSON.parse(row.fields), consents: consents.results, events: events.results, whatsapp };
}

export async function listMailingLists(db: D1Database): Promise<MailingList[]> {
	const { results } = await db.prepare(`SELECT l.id, l.name, count(m.contact_id) AS members FROM marketing_lists l
		LEFT JOIN marketing_list_members m ON m.list_id = l.id AND m.unsubscribed_at IS NULL GROUP BY l.id, l.name ORDER BY l.name`).all<MailingList>();
	return results;
}

export async function createMailingList(db: D1Database, name: string): Promise<MailingList | null> {
	const id = newId("lst");
	const result = await db.prepare("INSERT OR IGNORE INTO marketing_lists (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, Date.now()).run();
	return result.meta.changes ? { id, name, members: 0 } : null;
}

export async function deleteMailingList(db: D1Database, id: string) {
	await db.batch([
		db.prepare("DELETE FROM marketing_list_members WHERE list_id = ?").bind(id),
		db.prepare("DELETE FROM marketing_forms WHERE list_id = ?").bind(id),
		db.prepare("DELETE FROM marketing_hooks WHERE list_id = ?").bind(id),
		db.prepare("DELETE FROM marketing_lists WHERE id = ?").bind(id),
	]);
}

const eventStatement = (db: D1Database, contactId: string, type: string, detail: string, now: number) =>
	db.prepare("INSERT INTO marketing_events (id, contact_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)").bind(newId("evt"), contactId, type, detail, now);

/**
 * Adds or updates people. An address that left or was blocked is refused untouched (U6), a list a person
 * left stays left, and a consent that is already recorded is not written twice.
 */
export async function importContacts(
	db: D1Database,
	rows: ImportRow[],
	options: { listId: string | null; consent: Consent | null; tags?: string[]; origin: string; checkDomain?: (domain: string) => Promise<string | null>; now?: number },
): Promise<ImportReport> {
	const now = options.now ?? Date.now();
	const report: ImportReport = { added: 0, updated: 0, rejected: [] };
	const reject = (row: ImportRow, reason: string) => report.rejected.push({ line: row.line, email: row.email, reason });
	const seen = new Set<string>();
	const valid: (ImportRow & { hash: string })[] = [];
	for (const row of rows) {
		const email = normalizeEmail(row.email);
		if (!isValidEmail(email)) reject(row, "e-mail inválido");
		else if (isRoleAddress(email)) reject(row, ROLE_ADDRESS_REASON);
		else if (seen.has(email)) reject(row, "repetido no arquivo");
		else {
			seen.add(email);
			valid.push({ ...row, email, hash: await emailHash(email) });
		}
	}
	const blocked = new Set<string>();
	const existing = new Map<string, string>();
	for (const group of chunk(valid)) {
		const suppressed = await db.prepare(`SELECT email_hash FROM marketing_suppressions WHERE email_hash IN (${marks(group.length)})`).bind(...group.map((row) => row.hash)).all<{ email_hash: string }>();
		for (const row of suppressed.results) blocked.add(row.email_hash);
		const known = await db.prepare(`SELECT id, email FROM marketing_contacts WHERE email IN (${marks(group.length)})`).bind(...group.map((row) => row.email)).all<{ id: string; email: string }>();
		for (const row of known.results) existing.set(row.email, row.id);
	}
	const domains = new Map<string, string | null>();
	if (options.checkDomain) {
		for (const domain of new Set(valid.filter((row) => !blocked.has(row.hash)).map((row) => domainOf(row.email)))) domains.set(domain, await options.checkDomain(domain));
	}
	const statements: D1PreparedStatement[] = [];
	for (const row of valid) {
		const domainProblem = domains.get(domainOf(row.email));
		if (blocked.has(row.hash)) { reject(row, "saiu da lista ou está bloqueado"); continue; }
		if (domainProblem) { reject(row, domainProblem); continue; }
		const found = existing.get(row.email);
		const id = found ?? newId("con");
		if (found) {
			report.updated++;
			statements.push(db.prepare("UPDATE marketing_contacts SET name = CASE WHEN name = '' THEN ? ELSE name END, fields = json_patch(?, fields), updated_at = ? WHERE id = ?").bind(row.name, JSON.stringify(row.fields), now, id));
		} else {
			report.added++;
			statements.push(db.prepare("INSERT INTO marketing_contacts (id, email, email_hash, name, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, row.email, row.hash, row.name, JSON.stringify(row.fields), now, now));
			statements.push(eventStatement(db, id, "created", options.origin, now));
		}
		if (options.consent) {
			const { source, text, consentedAt } = options.consent;
			statements.push(db.prepare(`INSERT INTO marketing_consents (id, contact_id, source, text, consented_at, recorded_at)
				SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM marketing_consents WHERE contact_id = ? AND source = ? AND text = ? AND consented_at = ?)`)
				.bind(newId("cns"), id, source, text, consentedAt, now, id, source, text, consentedAt));
		}
		if (options.listId) statements.push(db.prepare("INSERT OR IGNORE INTO marketing_list_members (list_id, contact_id, created_at) VALUES (?, ?, ?)").bind(options.listId, id, now));
		for (const tag of options.tags ?? []) statements.push(db.prepare("INSERT OR IGNORE INTO marketing_contact_tags (contact_id, tag, created_at) VALUES (?, ?, ?)").bind(id, tag, now));
	}
	await runBatches(db, statements);
	report.rejected.sort((a, b) => a.line - b.line);
	return report;
}

export async function updateContact(db: D1Database, id: string, patch: { name?: string; tags?: string[]; listIds?: string[]; consent?: Consent | null }, now = Date.now()) {
	const statements: D1PreparedStatement[] = [];
	if (patch.name !== undefined) statements.push(db.prepare("UPDATE marketing_contacts SET name = ?, updated_at = ? WHERE id = ?").bind(patch.name, now, id));
	if (patch.tags) {
		// Only what was removed is deleted: a tag kept keeps the date it was given.
		statements.push(db.prepare("DELETE FROM marketing_contact_tags WHERE contact_id = ? AND tag NOT IN (SELECT value FROM json_each(?))").bind(id, JSON.stringify(patch.tags)));
		for (const tag of patch.tags) statements.push(db.prepare("INSERT OR IGNORE INTO marketing_contact_tags (contact_id, tag, created_at) VALUES (?, ?, ?)").bind(id, tag, now));
	}
	if (patch.listIds) {
		const current = await db.prepare("SELECT list_id, unsubscribed_at FROM marketing_list_members WHERE contact_id = ?").bind(id).all<{ list_id: string; unsubscribed_at: number | null }>();
		const wanted = new Set(patch.listIds);
		// A list the person left keeps its row, so adding it again here cannot bring them back.
		for (const row of current.results) {
			if (!wanted.has(row.list_id) && row.unsubscribed_at === null) statements.push(db.prepare("DELETE FROM marketing_list_members WHERE contact_id = ? AND list_id = ?").bind(id, row.list_id));
		}
		for (const listId of wanted) statements.push(db.prepare("INSERT OR IGNORE INTO marketing_list_members (list_id, contact_id, created_at) SELECT id, ?, ? FROM marketing_lists WHERE id = ?").bind(id, now, listId));
	}
	if (patch.consent) {
		const { source, text, consentedAt } = patch.consent;
		statements.push(db.prepare("INSERT INTO marketing_consents (id, contact_id, source, text, consented_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId("cns"), id, source, text, consentedAt, now));
	}
	if (statements.length) await runBatches(db, statements);
}

/** Deletes everything about a person except the hash that keeps the address from coming back (C6). */
export async function eraseContact(db: D1Database, id: string, now = Date.now()): Promise<boolean> {
	const row = await db.prepare("SELECT email, email_hash FROM marketing_contacts WHERE id = ?").bind(id).first<{ email: string; email_hash: string }>();
	if (!row) return false;
	await db.batch([
		db.prepare("DELETE FROM marketing_pending WHERE email = ?").bind(row.email),
		db.prepare("INSERT OR IGNORE INTO marketing_suppressions (email_hash, reason, created_at) VALUES (?, 'erased', ?)").bind(row.email_hash, now),
		...["marketing_consents", "marketing_events", "marketing_list_members", "marketing_contact_tags", "marketing_flow_runs", "marketing_whatsapp", "marketing_whatsapp_sends"].map((table) => db.prepare(`DELETE FROM ${table} WHERE contact_id = ?`).bind(id)),
		db.prepare("DELETE FROM marketing_contacts WHERE id = ?").bind(id),
	]);
	return true;
}

/** The person asked to stop receiving on WhatsApp. E-mail is not affected. */
export async function stopWhatsApp(db: D1Database, id: string, now = Date.now()): Promise<boolean> {
	const changed = await db.prepare("UPDATE marketing_whatsapp SET opted_out_at = ? WHERE contact_id = ? AND opted_out_at IS NULL").bind(now, id).run();
	if (changed.meta.changes) await eventStatement(db, id, "whatsapp_stopped", "", now).run();
	return changed.meta.changes > 0;
}

/** Leaves every list at once. Takes effect immediately, including for sends still queued (U3). */
export async function unsubscribeAll(db: D1Database, id: string, detail: string, now = Date.now()): Promise<boolean> {
	const row = await db.prepare("SELECT email_hash FROM marketing_contacts WHERE id = ?").bind(id).first<{ email_hash: string }>();
	if (!row) return false;
	const added = await db.prepare("INSERT OR IGNORE INTO marketing_suppressions (email_hash, reason, created_at) VALUES (?, 'unsubscribe', ?)").bind(row.email_hash, now).run();
	if (added.meta.changes) await eventStatement(db, id, "unsubscribed", detail, now).run();
	return true;
}

/** The person's own choice on the preferences page: the only thing that can bring a list back. */
export async function saveListPreferences(db: D1Database, id: string, keep: string[], now = Date.now()) {
	const { results } = await db.prepare("SELECT m.list_id, m.unsubscribed_at, l.name FROM marketing_list_members m JOIN marketing_lists l ON l.id = m.list_id WHERE m.contact_id = ?").bind(id).all<{ list_id: string; unsubscribed_at: number | null; name: string }>();
	const statements: D1PreparedStatement[] = [];
	for (const row of results) {
		const stays = keep.includes(row.list_id);
		if (stays === (row.unsubscribed_at === null)) continue;
		statements.push(db.prepare("UPDATE marketing_list_members SET unsubscribed_at = ? WHERE contact_id = ? AND list_id = ?").bind(stays ? null : now, id, row.list_id));
		statements.push(eventStatement(db, id, stays ? "list_rejoined" : "list_left", row.name, now));
	}
	if (statements.length) await runBatches(db, statements);
}

const ELIGIBLE = `FROM marketing_list_members m
	JOIN marketing_contacts c ON c.id = m.contact_id
	WHERE m.list_id = ? AND m.unsubscribed_at IS NULL AND ${CONSENTED}
	AND NOT EXISTS (SELECT 1 FROM marketing_suppressions s WHERE s.email_hash = c.email_hash)`;

/** Who a campaign to a list may reach: consented, still on the list, never blocked (C3, U3). */
export async function eligibleRecipients(db: D1Database, listId: string, after = "", limit = 500) {
	const { results } = await db.prepare(`SELECT c.id, c.email, c.name ${ELIGIBLE} AND c.id > ? ORDER BY c.id LIMIT ?`).bind(listId, after, limit).all<{ id: string; email: string; name: string }>();
	return results;
}

/** Asked again right before each message leaves, so a late unsubscribe still counts. */
export async function canReceive(db: D1Database, contactId: string, listId: string): Promise<boolean> {
	return !!(await db.prepare(`SELECT 1 AS ok ${ELIGIBLE} AND c.id = ?`).bind(listId, contactId).first());
}
