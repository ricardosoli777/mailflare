import type { TurnstileAction, TurnstileResponse } from "./turnstile-types";

const hostnameOf = (value: string | null | undefined): string | null => {
	if (!value?.trim()) return null;
	try {
		return new URL(value.includes("://") ? value : `https://${value}`).hostname;
	} catch {
		return null;
	}
};

/** The token must come from the same screen and from a host this install answers on. */
export function turnstileMismatch(result: TurnstileResponse, request: Request, appUrl: string | undefined, action: TurnstileAction): "action" | "hostname" | null {
	// Cloudflare's published test keys answer with a made-up host and action.
	if (result.metadata?.result_with_testing_key) return null;
	if (result.action !== action) return "action";
	const hosts = [request.url, request.headers.get("host"), appUrl].map(hostnameOf);
	return result.hostname && hosts.includes(result.hostname) ? null : "hostname";
}
