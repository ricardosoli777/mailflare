export type Provider = "gmail" | "outlook" | "yahoo" | "other";

export type SenderSettings = {
	fromName: string;
	fromEmail: string;
	replyTo: string;
	/** Public https origin used in unsubscribe links; the cron has no request to read it from. */
	origin: string;
	weeklyLimit?: number;
	hourlyByProvider: Record<Provider, number>;
};

export type Quota = { max24Hour: number; maxPerSecond: number; sentLast24Hours: number; sendingEnabled: boolean; enforcement?: string };

export type BreakerStats = { sent: number; bounced: number; complained: number };

export type OutgoingMessage = { to: string; from: string; replyTo: string; subject: string; html: string; text: string; headers: Record<string, string> };

export type EngineDeps = {
	quota: () => Promise<Quota>;
	/** Why the sender is not allowed to send (R1, R2), or null. */
	preflight?: () => Promise<string | null>;
	send: (message: OutgoingMessage) => Promise<{ messageId: string }>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

export type RunResult = { sent: number; skipped: number; failed: number; blocked: string | null };
