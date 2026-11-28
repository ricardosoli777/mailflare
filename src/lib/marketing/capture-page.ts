/** The public pages and the mail of the double opt-in flow. */
import type { CaptureForm, FormField } from "./capture-types";
import { esc, page } from "./unsubscribe-page";

const inputType = (field: FormField) => (/telefone|whats|celular|fone/.test(field.key) ? "tel" : "text");

export function formPage(form: CaptureForm, options: { email?: string; name?: string; fields?: Record<string, string>; whatsapp?: string; phone?: string; error?: string; siteKey?: string; status?: number } = {}): Response {
	const captcha = options.siteKey
		? `<div class="cf-turnstile" data-sitekey="${esc(options.siteKey)}" data-action="capture" style="margin-top:12px"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
		: "";
	return page(`<h1>${esc(form.name)}</h1>${options.error ? `<p role="alert"><strong>${esc(options.error)}</strong></p>` : ""}<form method="post">
<input name="name" placeholder="Seu nome" aria-label="Seu nome" maxlength="120" autocomplete="name" value="${esc(options.name ?? "")}">
<input name="email" type="email" placeholder="Seu e-mail" aria-label="Seu e-mail" maxlength="254" autocomplete="email" required value="${esc(options.email ?? "")}">
${form.fields.map((field) => `<input name="campo.${esc(field.key)}" type="${inputType(field)}" placeholder="${esc(field.label)}" aria-label="${esc(field.label)}" maxlength="500"${field.required ? " required" : ""} value="${esc(options.fields?.[field.key] ?? "")}">\n`).join("")}<div class="trap" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
${form.whatsappText ? `<input name="whatsapp_phone" type="tel" placeholder="Seu WhatsApp com DDD" aria-label="Seu WhatsApp com DDD" maxlength="30" autocomplete="tel" value="${esc(options.phone ?? "")}">\n<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;text-align:left"><input type="checkbox" name="whatsapp_ok" value="1" style="width:auto;margin-top:2px"${options.whatsapp !== undefined ? " checked" : ""}> <span>${esc(form.whatsappText)}</span></label>\n` : ""}<p style="font-size:13px">${esc(form.consentText)}</p>${captcha}<button class="primary">${esc(form.button)}</button></form>`, options.status ?? 200, form.name);
}

export const notFoundPage = () => page("<h1>Endereço não encontrado</h1><p>Este formulário ou link não existe mais.</p>", 404, "Não encontrado");

export const subscribedPage = () => page("<h1>Cadastro recebido</h1><p>Obrigado.</p>", 200, "Cadastro");

export const checkInboxPage = () => page("<h1>Confira seu e-mail</h1><p>Enviamos um link para confirmar. Sem a confirmação você não recebe nada. Veja também a caixa de spam.</p>", 200, "Confirme seu e-mail");

/** A button, not the link itself, confirms: security scanners open the links in mail. */
export const confirmPage = () => page('<h1>Confirmar inscrição</h1><p>Clique no botão para começar a receber.</p><form method="post"><button class="primary">Confirmar</button></form>', 200, "Confirmar inscrição");

export const confirmedPage = () => page("<h1>Inscrição confirmada</h1><p>Pronto. Você pode sair quando quiser pelo link no fim de cada mensagem.</p>", 200, "Inscrição confirmada");

export function confirmationMessage(sender: string, formName: string, url: string) {
	const ignore = "Se não foi você, ignore esta mensagem: nada será enviado.";
	return {
		subject: `Confirme sua inscrição em ${sender}`.replace(/[\r\n]+/g, " "),
		text: `Para confirmar sua inscrição (${formName}), abra:\n${url}\n\n${ignore}`,
		html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202124;max-width:480px;margin:0 auto;padding:24px"><p>Alguém pediu para inscrever este endereço em <strong>${esc(sender)}</strong> (${esc(formName)}).</p><p><a href="${esc(url)}" style="display:inline-block;background:#0b57d0;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:8px">Confirmar inscrição</a></p><p style="font-size:13px;color:#5f6368">${ignore}</p></div>`,
	};
}
