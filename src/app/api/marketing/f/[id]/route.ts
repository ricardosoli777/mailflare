/**
 * Public capture form (I1). External pages may post to it, so there is no session and no Origin check.
 * GET only shows the form.
 */
import { turnstileSiteKey, verifyTurnstileToken } from "@/lib/auth/turnstile";
import { getEnv } from "@/lib/cloudflare";
import { getForm, submitForm } from "@/lib/marketing/capture";
import { checkInboxPage, formPage, notFoundPage, subscribedPage } from "@/lib/marketing/capture-page";
import { overLimit, readSmallBody } from "@/lib/marketing/capture-public";
import { checkMailDomain } from "@/lib/marketing/domain-check";
import { sendConfirmationMail } from "@/lib/marketing/run";

type Context = { params: Promise<{ id: string }> };

async function load({ params }: Context) {
	const env = getEnv();
	const db = env.MARKETING_DB;
	const form = db ? await getForm(db, (await params).id) : null;
	// The widget needs the public key and the check needs the secret: with only one, neither is used.
	const siteKey = env.TURNSTILE_SECRET_KEY ? turnstileSiteKey(env) : undefined;
	return form ? { env, db: db!, form, siteKey } : null;
}

export async function GET(_request: Request, context: Context) {
	const found = await load(context);
	return found ? formPage(found.form, { siteKey: found.siteKey }) : notFoundPage();
}

export async function POST(request: Request, context: Context) {
	const found = await load(context);
	if (!found) return notFoundPage();
	const { env, db, form, siteKey } = found;
	if (await overLimit(env, request, "form")) return new Response("Too many requests", { status: 429 });
	const body = await readSmallBody(request);
	if (body === null) return new Response("Payload too large", { status: 413 });
	const data = new URLSearchParams(body);
	const fields = Object.fromEntries(form.fields.map((field) => [field.key, data.get(`campo.${field.key}`) ?? ""]));
	const phone = data.get("whatsapp_phone") ?? "";
	const input = { email: data.get("email") ?? "", name: data.get("name") ?? "", fields, phone, whatsapp: data.get("whatsapp_ok") ? phone : undefined };
	// Only a program fills the hidden field. It gets the usual answer and nothing happens.
	if (data.get("website")) return form.doubleOptIn ? checkInboxPage() : subscribedPage();
	// A snippet on another site carries no token: the person finishes here, where the widget is.
	if (siteKey && !(await verifyTurnstileToken(env, request, data.get("cf-turnstile-response")))) {
		return formPage(form, { ...input, siteKey, error: "Confirme que você não é um robô." });
	}
	const result = await submitForm(db, form, input, {
		sendConfirmation: (email, _name, token) => sendConfirmationMail(env, db, email, form.name, token),
		checkDomain: checkMailDomain,
	});
	if (!result.ok) return formPage(form, { ...input, siteKey, error: result.error, status: 422 });
	return result.confirm ? checkInboxPage() : subscribedPage();
}
