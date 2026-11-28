import { getClientIp } from "@/lib/auth/client-ip";
import type { TurnstileAction, TurnstileResponse } from "./turnstile-types";
import { turnstileMismatch } from "./turnstile-utils";

/** The public widget key. Read at run time, so changing it needs no new build; the build-time name still works. */
export function turnstileSiteKey(env: Pick<CloudflareEnv, "TURNSTILE_SITE_KEY">): string | undefined {
	return env.TURNSTILE_SITE_KEY?.trim() || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

export async function verifyTurnstileToken(
	env: Pick<CloudflareEnv, "TURNSTILE_SECRET_KEY" | "APP_URL">,
	request: Request,
	token: unknown,
	action: TurnstileAction,
): Promise<boolean> {
	const secret = env.TURNSTILE_SECRET_KEY?.trim();
	if (!secret) return true;
	if (typeof token !== "string" || !token.trim() || token.length > 2048) return false;

	let response: Response;
	try {
		response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: AbortSignal.timeout(10_000),
			body: JSON.stringify({
				secret,
				response: token,
				remoteip: getClientIp(request) ?? undefined,
			}),
		});
	} catch {
		return false;
	}

	const result = (await response.json().catch(() => null)) as TurnstileResponse | null;
	// The codes say whether the secret or the token was refused; neither value is ever logged.
	if (!result?.success) console.warn("Turnstile refused", response.status, result?.["error-codes"]?.join(",") ?? "");
	if (!response.ok || !result) return false;
	if (!result.success) return false;
	const mismatch = turnstileMismatch(result, request, env.APP_URL, action);
	if (mismatch) console.warn("Turnstile refused", mismatch);
	return !mismatch;
}
