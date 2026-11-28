import { AuthGuard } from "@/components/auth/auth-guard";
import { turnstileSiteKey } from "@/lib/auth/turnstile";
import { getEnv } from "@/lib/cloudflare";
import { authPageMetadata } from "../auth-metadata";
import { ForgotPasswordClient } from "./forgot-password-client";

export const dynamic = "force-dynamic";

export const generateMetadata = () => authPageMetadata("auth.forgot.title");

export default function ForgotPasswordPage() {
	return (
		<AuthGuard mode="public">
			<ForgotPasswordClient turnstileSiteKey={turnstileSiteKey(getEnv())} />
		</AuthGuard>
	);
}
