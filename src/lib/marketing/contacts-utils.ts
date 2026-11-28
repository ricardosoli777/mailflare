import { parseCsv } from "@/lib/contacts/google-csv";
import type { Consent, ImportRow } from "./contacts-types";

/** One import request: small enough for a Worker's DNS lookups and database writes. */
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_DOMAINS = 40;

/** Large providers that certainly receive mail, so they need no DNS lookup. */
export const KNOWN_DOMAINS = new Set([
	"gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com",
	"yahoo.com", "yahoo.com.br", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br",
]);

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function isValidEmail(email: string): boolean {
	return email.length <= 254 && email.indexOf("@") <= 64 && EMAIL.test(email);
}

/** Role mailboxes watched by providers and anti-spam teams; AWS says never to mail them. */
const ROLE_ADDRESSES = new Set(["abuse", "postmaster", "noc", "spam", "mailer-daemon", "noreply", "no-reply"]);
export const isRoleAddress = (email: string) => ROLE_ADDRESSES.has(email.slice(0, email.indexOf("@")).split("+")[0]);
export const ROLE_ADDRESS_REASON = "endereço de função (abuse@, postmaster@ e semelhantes) não recebe marketing";

export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

export async function emailHash(email: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email)));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeTags(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return [...new Set(raw.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

/** Extra data about a person, from untrusted input. */
export function cleanFields(input: unknown): Record<string, string> {
	const fields: Record<string, string> = {};
	if (!input || typeof input !== "object" || Array.isArray(input)) return fields;
	for (const [name, raw] of Object.entries(input)) {
		const key = name.trim().toLowerCase().slice(0, 60);
		const value = typeof raw === "string" || typeof raw === "number" ? String(raw).trim().slice(0, 500) : "";
		if (key && value && Object.keys(fields).length < 20) fields[key] = value;
	}
	return fields;
}

/** The origin, the text the person accepted and when. All three or no consent at all. */
export function readConsent(input: unknown, now = Date.now()): Consent | null {
	const value = (input ?? {}) as { source?: unknown; text?: unknown; date?: unknown };
	const source = typeof value.source === "string" ? value.source.trim().slice(0, 200) : "";
	const text = typeof value.text === "string" ? value.text.trim().slice(0, 1000) : "";
	const consentedAt = typeof value.date === "string" ? Date.parse(value.date) : NaN;
	// A day of slack covers time zones; anything further ahead is a typo.
	if (!source || !text || !Number.isFinite(consentedAt) || consentedAt > now + 86_400_000) return null;
	return { source, text, consentedAt };
}

/** Reads a contacts file: a column named e-mail is required, "nome" fills the name, other columns become fields. */
export function parseImportCsv(text: string): { rows: ImportRow[] } | { error: string } {
	let { rows } = parseCsv(text.replace(/^﻿/, ""));
	if (!rows.length) return { error: "O arquivo está vazio." };
	// Spreadsheets in Portuguese export with semicolons.
	if (rows[0].length === 1 && rows[0][0].includes(";")) {
		rows = rows.map((row) => row.join(",").split(";").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")));
	}
	const header = rows[0].map((name) => name.trim().toLowerCase());
	const emailColumn = header.findIndex((name) => ["email", "e-mail", "mail"].includes(name));
	if (emailColumn < 0) return { error: "A primeira linha precisa ter uma coluna chamada \"email\"." };
	const nameColumn = header.findIndex((name) => ["nome", "name"].includes(name));
	return {
		rows: rows.slice(1).map((row, index) => {
			const fields: Record<string, string> = {};
			header.forEach((name, column) => {
				const value = row[column]?.trim();
				if (name && value && column !== emailColumn && column !== nameColumn && Object.keys(fields).length < 20) fields[name.slice(0, 60)] = value.slice(0, 500);
			});
			return { line: index + 2, email: (row[emailColumn] ?? "").trim(), name: (row[nameColumn] ?? "").trim().slice(0, 200), fields };
		}),
	};
}

/** Splits rows so each request stays within both limits. */
export function chunkImportRows<T extends { email: string }>(rows: T[]): T[][] {
	const chunks: T[][] = [];
	let current: T[] = [];
	let domains = new Set<string>();
	for (const row of rows) {
		const domain = domainOf(normalizeEmail(row.email));
		const lookup = !KNOWN_DOMAINS.has(domain) && !domains.has(domain);
		if (current.length >= MAX_IMPORT_ROWS || (lookup && domains.size >= MAX_IMPORT_DOMAINS)) {
			chunks.push(current);
			current = [];
			domains = new Set();
		}
		current.push(row);
		if (!KNOWN_DOMAINS.has(domain)) domains.add(domain);
	}
	if (current.length) chunks.push(current);
	return chunks;
}
