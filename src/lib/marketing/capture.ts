/** Capture forms with double opt-in, API keys and signed incoming webhooks (R6, I1-I3). */
import { newId } from "@/lib/ids";
import type { CaptureForm, CaptureHook, CaptureKey, FormField, SubmitResult } from "./capture-types";
import { importContacts, unsubscribeAll } from "./contacts";
import { cleanFields, emailHash, isValidEmail, normalizeEmail, normalizeTags, isRoleAddress } from "./contacts-utils";
import { readPhone } from "./whatsapp";

const HOUR = 60 * 60 * 1000;
export const CONFIRM_TTL_MS = 7 * 24 * HOUR;
/** A public form must not be usable to flood strangers with confirmation mail. */
export const MAX_CONFIRMATIONS_PER_DAY = 200;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

type TargetRow = { id: string; name: string; list_id: string; tags: string; consent_text: string };
const target = (row: TargetRow) => ({ id: row.id, name: row.name, listId: row.list_id, tags: JSON.parse(row.tags) as string[], consentText: row.consent_text });

/** The fields forms and webhooks share. Returns an error message when something is missing. */
export async function readTarget(db: D1Database, input: unknown) {
	const value = (input ?? {}) as Record<string, unknown>;
	const text = (key: string, max: number) => (typeof value[key] === "string" ? (value[key] as string).trim().slice(0, max) : "");
	const name = text("name", 100);
	const listId = text("listId", 80);
	const consentText = text("consentText", 500);
	if (!name) return { error: "Dê um nome." } as const;
	if (!consentText) return { error: "Escreva o que a pessoa está aceitando." } as const;
	if (!(await db.prepare("SELECT 1 AS ok FROM marketing_lists WHERE id = ?").bind(listId).first())) return { error: "Escolha uma lista." } as const;
	return { name, listId, consentText, tags: normalizeTags(value.tags), error: null } as const;
}

type Target = { name: string; listId: string; consentText: string; tags: readonly string[] };

export const MAX_FORM_FIELDS = 8;
export const DEFAULT_BUTTON = "Quero receber";
export const DEFAULT_CONSENT = "Aceito receber novidades e ofertas por e-mail.";
export const DEFAULT_WHATSAPP_CONSENT = "Quero receber mensagens e áudios pelo WhatsApp.";
// Name and e-mail are always there, and "website" is the field only robots fill.
const RESERVED = new Set(["email", "e-mail", "nome", "name", "website", "whatsapp_phone", "whatsapp_ok"]);

/** The extra fields and the button text of a form. */
export function readFormExtras(input: unknown): { fields: FormField[]; button: string; whatsappText: string } {
	const value = (input ?? {}) as { fields?: unknown; button?: unknown; whatsapp?: unknown; whatsappText?: unknown };
	const fields: FormField[] = [];
	for (const raw of Array.isArray(value.fields) ? (value.fields as { label?: unknown; required?: unknown }[]) : []) {
		const label = typeof raw?.label === "string" ? raw.label.trim().slice(0, 60) : "";
		const key = label.toLowerCase();
		if (!key || RESERVED.has(key) || fields.some((field) => field.key === key) || fields.length >= MAX_FORM_FIELDS) continue;
		fields.push({ key, label, required: raw.required === true });
	}
	const button = typeof value.button === "string" ? value.button.trim().slice(0, 40) : "";
	const text = typeof value.whatsappText === "string" ? value.whatsappText.trim().slice(0, 300) : "";
	return { fields, button: button || DEFAULT_BUTTON, whatsappText: value.whatsapp === true ? text || DEFAULT_WHATSAPP_CONSENT : "" };
}

type FormInput = Target & { doubleOptIn?: boolean; fields?: FormField[]; button?: string; whatsappText?: string };
const formValues = (input: FormInput) => [input.name, input.listId, JSON.stringify(input.tags), input.consentText, input.doubleOptIn === false ? 0 : 1, JSON.stringify(input.fields ?? []), input.button ?? DEFAULT_BUTTON, input.whatsappText ?? ""];

export async function createForm(db: D1Database, input: FormInput, now = Date.now()): Promise<string> {
	const id = newId("frm");
	await db.prepare("INSERT INTO marketing_forms (id, name, list_id, tags, consent_text, double_opt_in, fields, button, whatsapp_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(id, ...formValues(input), now).run();
	return id;
}

export async function updateForm(db: D1Database, id: string, input: FormInput): Promise<boolean> {
	return (await db.prepare("UPDATE marketing_forms SET name = ?, list_id = ?, tags = ?, consent_text = ?, double_opt_in = ?, fields = ?, button = ?, whatsapp_text = ? WHERE id = ?")
		.bind(...formValues(input), id).run()).meta.changes > 0;
}

type FormRow = TargetRow & { double_opt_in: number; fields: string; button: string; whatsapp_text: string };
const FORM_COLUMNS = "id, name, list_id, tags, consent_text, double_opt_in, fields, button, whatsapp_text";
const toForm = (row: FormRow): CaptureForm => ({ ...target(row), doubleOptIn: !!row.double_opt_in, fields: JSON.parse(row.fields), button: row.button, whatsappText: row.whatsapp_text });

export async function getForm(db: D1Database, id: string): Promise<CaptureForm | null> {
	const row = await db.prepare(`SELECT ${FORM_COLUMNS} FROM marketing_forms f WHERE id = ? AND EXISTS (SELECT 1 FROM marketing_lists l WHERE l.id = f.list_id)`).bind(id).first<FormRow>();
	return row ? toForm(row) : null;
}

export async function createHook(db: D1Database, input: Target, now = Date.now()): Promise<string> {
	const id = newId("hok");
	await db.prepare("INSERT INTO marketing_hooks (id, name, list_id, tags, consent_text, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, input.name, input.listId, JSON.stringify(input.tags), input.consentText, randomSecret(), now).run();
	return id;
}

export async function getHook(db: D1Database, id: string): Promise<CaptureHook | null> {
	const row = await db.prepare("SELECT id, name, list_id, tags, consent_text, secret FROM marketing_hooks h WHERE id = ? AND EXISTS (SELECT 1 FROM marketing_lists l WHERE l.id = h.list_id)").bind(id).first<TargetRow & { secret: string }>();
	return row ? { ...target(row), secret: row.secret } : null;
}

export async function listCapture(db: D1Database): Promise<{ forms: CaptureForm[]; hooks: CaptureHook[]; keys: CaptureKey[] }> {
	const [forms, hooks, keys] = await Promise.all([
		db.prepare(`SELECT ${FORM_COLUMNS} FROM marketing_forms ORDER BY created_at DESC LIMIT 100`).all<FormRow>(),
		db.prepare("SELECT id, name, list_id, tags, consent_text, secret FROM marketing_hooks ORDER BY created_at DESC LIMIT 100").all<TargetRow & { secret: string }>(),
		db.prepare("SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM marketing_api_keys ORDER BY created_at DESC LIMIT 100").all<CaptureKey>(),
	]);
	return {
		forms: forms.results.map(toForm),
		hooks: hooks.results.map((row) => ({ ...target(row), secret: row.secret })),
		keys: keys.results,
	};
}

const TABLES = { form: "marketing_forms", hook: "marketing_hooks", key: "marketing_api_keys" } as const;
export type CaptureKind = keyof typeof TABLES;
export const isCaptureKind = (value: unknown): value is CaptureKind => typeof value === "string" && Object.hasOwn(TABLES, value);

export async function deleteCapture(db: D1Database, kind: CaptureKind, id: string): Promise<boolean> {
	return (await db.prepare(`DELETE FROM ${TABLES[kind]} WHERE id = ?`).bind(id).run()).meta.changes > 0;
}

/** The key is returned once; only its hash is stored. */
export async function createApiKey(db: D1Database, name: string, now = Date.now()): Promise<string> {
	const key = `mk_${randomSecret()}`;
	await db.prepare("INSERT INTO marketing_api_keys (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)").bind(newId("key"), name, await sha256(key), now).run();
	return key;
}

export async function authenticateKey(db: D1Database, authorization: string | null, now = Date.now()): Promise<boolean> {
	const key = /^Bearer (mk_[A-Za-z0-9_-]{20,100})$/.exec(authorization ?? "")?.[1];
	if (!key) return false;
	return (await db.prepare("UPDATE marketing_api_keys SET last_used_at = ? WHERE key_hash = ?").bind(now, await sha256(key)).run()).meta.changes > 0;
}

/** `X-MailLead-Signature`: hex HMAC-SHA256 of the raw body, with or without a `sha256=` prefix. */
export async function verifyHookSignature(secret: string, body: string, header: string | null): Promise<boolean> {
	const given = (header ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const expected = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (byte) => byte.toString(16).padStart(2, "0")).join("");
	if (given.length !== expected.length) return false;
	let difference = 0;
	for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ given.charCodeAt(index);
	return difference === 0;
}

const suppression = async (db: D1Database, email: string) =>
	(await db.prepare("SELECT reason FROM marketing_suppressions WHERE email_hash = ?").bind(await emailHash(email)).first<{ reason: string }>())?.reason ?? null;

/**
 * Records the WhatsApp permission of someone who just signed up. Only a sign-up confirmed by e-mail
 * undoes an earlier "stop": anyone can type an address into a form without confirmation.
 */
async function allowWhatsApp(db: D1Database, form: CaptureForm, email: string, phone: string, confirmed: boolean, now: number): Promise<void> {
	await db.prepare(`INSERT INTO marketing_whatsapp (contact_id, phone, source, text, consented_at)
		SELECT id, ?, ?, ?, ? FROM marketing_contacts WHERE email = ?
		ON CONFLICT (contact_id) DO UPDATE SET phone = excluded.phone, source = excluded.source, text = excluded.text, consented_at = excluded.consented_at, opted_out_at = NULL
		${confirmed ? "" : "WHERE marketing_whatsapp.opted_out_at IS NULL"}`)
		.bind(phone, `formulário ${form.name}`, form.whatsappText, now, email).run();
}

/**
 * A public form submission. The answer never says whether the address was already known, so the
 * form cannot be used to find out who is on a list.
 */
export async function submitForm(
	db: D1Database,
	form: CaptureForm,
	// `whatsapp` is the number typed, present only when the person ticked the box.
	input: { email: string; name: string; fields?: Record<string, string>; whatsapp?: string },
	deps: { sendConfirmation: (email: string, name: string, token: string) => Promise<void>; checkDomain?: (domain: string) => Promise<string | null> },
	now = Date.now(),
): Promise<SubmitResult> {
	const email = normalizeEmail(input.email);
	const name = input.name.trim().slice(0, 120);
	if (!isValidEmail(email)) return { ok: false, error: "Confira o e-mail digitado." };
	if (isRoleAddress(email)) return { ok: false, error: "Use um e-mail pessoal ou de contato." };
	if (deps.checkDomain && (await deps.checkDomain(email.slice(email.lastIndexOf("@") + 1)))) return { ok: false, error: "Não foi possível confirmar o domínio deste e-mail." };
	const wantsWhatsApp = !!form.whatsappText && input.whatsapp !== undefined;
	const phone = wantsWhatsApp ? readPhone(input.whatsapp) : null;
	if (wantsWhatsApp && !phone) return { ok: false, error: "Informe o WhatsApp com DDD, por exemplo 11 99999-9999." };
	// Only the fields the form asks for are kept.
	const given = cleanFields(input.fields);
	const fields: Record<string, string> = {};
	for (const field of form.fields) {
		if (Object.hasOwn(given, field.key)) fields[field.key] = given[field.key];
		else if (field.required) return { ok: false, error: `Preencha o campo ${field.label}.` };
	}

	if (!form.doubleOptIn) {
		await importContacts(db, [{ line: 1, email, name, fields }], { listId: form.listId, consent: { source: `formulário ${form.name}`, text: form.consentText, consentedAt: now }, tags: form.tags, origin: "formulário", now });
		// A blocked address is refused by the import, and then gets no permission either.
		if (phone && !(await suppression(db, email))) await allowWhatsApp(db, form, email, phone, false, now);
		return { ok: true, confirm: false };
	}

	const done: SubmitResult = { ok: true, confirm: true };
	// Nothing is sent to an address that bounced or complained.
	const reason = await suppression(db, email);
	if (reason === "bounce" || reason === "complaint") return done;
	await db.prepare("DELETE FROM marketing_pending WHERE created_at < ?").bind(now - CONFIRM_TTL_MS).run();
	if (await db.prepare("SELECT 1 AS ok FROM marketing_pending WHERE email = ? AND created_at > ?").bind(email, now - HOUR).first()) return done;
	const today = await db.prepare("SELECT COUNT(*) AS n FROM marketing_pending WHERE created_at > ?").bind(now - 24 * HOUR).first<{ n: number }>();
	if (today!.n >= MAX_CONFIRMATIONS_PER_DAY) return { ok: false, error: "Muitos cadastros no momento. Tente novamente amanhã." };

	const token = randomSecret();
	const hash = await sha256(token);
	await db.prepare("INSERT INTO marketing_pending (token_hash, form_id, email, name, fields, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(hash, form.id, email, name, JSON.stringify(fields), phone ?? "", now).run();
	try {
		await deps.sendConfirmation(email, name, token);
	} catch (error) {
		// Not sent, so a new attempt must not be held back.
		await db.prepare("DELETE FROM marketing_pending WHERE token_hash = ?").bind(hash).run();
		console.error("Confirmation mail failed", error);
		return { ok: false, error: "Não foi possível enviar a confirmação agora. Tente mais tarde." };
	}
	return done;
}

type Pending = { form_id: string; email: string; name: string; fields: string; phone: string; confirmed_at: number | null };

export async function findPending(db: D1Database, token: string, now = Date.now()): Promise<Pending | null> {
	return db.prepare("SELECT form_id, email, name, fields, phone, confirmed_at FROM marketing_pending WHERE token_hash = ? AND created_at >= ?").bind(await sha256(token), now - CONFIRM_TTL_MS).first<Pending>();
}

/** The person clicked the button: consent is recorded now. */
export async function confirmSubscription(db: D1Database, token: string, now = Date.now()): Promise<boolean> {
	const pending = await findPending(db, token, now);
	if (!pending) return false;
	if (pending.confirmed_at) return true;
	const form = await getForm(db, pending.form_id);
	if (!form) return false;
	const hash = await emailHash(pending.email);
	const reason = await suppression(db, pending.email);
	if (reason === "bounce" || reason === "complaint") return false;
	if (reason) {
		// Their own new request undoes "unsubscribe" and "erased", for this list only: the others stay left.
		await db.prepare("UPDATE marketing_list_members SET unsubscribed_at = ? WHERE unsubscribed_at IS NULL AND list_id <> ? AND contact_id IN (SELECT id FROM marketing_contacts WHERE email_hash = ?)").bind(now, form.listId, hash).run();
		await db.prepare("DELETE FROM marketing_suppressions WHERE email_hash = ?").bind(hash).run();
	}
	await importContacts(db, [{ line: 1, email: pending.email, name: pending.name, fields: JSON.parse(pending.fields) }], { listId: form.listId, consent: { source: `formulário ${form.name} (confirmado por e-mail)`, text: form.consentText, consentedAt: now }, tags: form.tags, origin: "confirmação", now });
	if (pending.phone && form.whatsappText) await allowWhatsApp(db, form, pending.email, pending.phone, true, now);
	await db.prepare("UPDATE marketing_list_members SET unsubscribed_at = NULL WHERE list_id = ? AND contact_id IN (SELECT id FROM marketing_contacts WHERE email_hash = ?)").bind(form.listId, hash).run();
	await db.prepare("UPDATE marketing_pending SET confirmed_at = ? WHERE token_hash = ?").bind(now, await sha256(token)).run();
	return true;
}

/** Blocks an address on request of an integration, even one that is not a contact yet. */
export async function unsubscribeEmail(db: D1Database, address: string, now = Date.now()): Promise<boolean> {
	const email = normalizeEmail(address);
	if (!isValidEmail(email)) return false;
	const contact = await db.prepare("SELECT id FROM marketing_contacts WHERE email = ?").bind(email).first<{ id: string }>();
	if (contact) return unsubscribeAll(db, contact.id, "API", now);
	await db.prepare("INSERT OR IGNORE INTO marketing_suppressions (email_hash, reason, created_at) VALUES (?, 'unsubscribe', ?)").bind(await emailHash(email), now).run();
	return true;
}
