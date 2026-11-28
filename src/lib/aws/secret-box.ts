/** AES-GCM for secrets kept in the database, so a database dump or backup does not carry them in the clear. */
const PREFIX = "enc:v1:";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function keyFrom(secret: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const isSealed = (value: string) => value.startsWith(PREFIX);

export async function seal(value: string, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(secret), new TextEncoder().encode(value));
	return `${PREFIX}${toBase64(iv)}.${toBase64(new Uint8Array(data))}`;
}

/** Null when the key is missing or wrong, or the value was altered. */
export async function open(value: string, secret: string | undefined): Promise<string | null> {
	if (!secret) return null;
	const [iv, data] = value.slice(PREFIX.length).split(".");
	try {
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await keyFrom(secret), fromBase64(data));
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}
