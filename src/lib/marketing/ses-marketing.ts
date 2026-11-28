/** Amazon SES side of marketing: quota, sender checks and the event feed. */
import { AwsError, awsJson } from "@/lib/aws/client";
import { getAwsConfig } from "@/lib/aws/config";
import type { AwsConfig } from "@/lib/aws/aws-types";
import { createTopic, subscribeHttps } from "@/lib/aws/sns";
import { organisationalDomain } from "@/lib/deliverability/org-domain";
import { queryDns } from "@/lib/dns-query";
import { isMailDomain } from "@/lib/marketing-mail-domain";
import { readSetting, writeSetting } from "./engine";
import type { Quota, SenderSettings } from "./sending-types";

export const CONFIGURATION_SET = "maillead-marketing";
const TOPIC = "maillead-marketing-events";

/** Events only count as working once SNS confirmed this endpoint AND SES publishes to the topic. */
export type SesFeed = { token: string; topicArn: string; endpoint: string; confirmed: boolean; publishing: boolean };
export type Check = { id: string; label: string; ok: boolean; detail: string };

const api = (config: AwsConfig, path: string) => ({ config, service: "ses", host: `email.${config.region}.amazonaws.com`, path });

export async function getQuota(config: AwsConfig): Promise<Quota> {
	const account = await awsJson<{ SendingEnabled?: boolean; EnforcementStatus?: string; SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number } }>(api(config, "/v2/email/account"));
	return {
		max24Hour: account.SendQuota?.Max24HourSend ?? 0,
		maxPerSecond: account.SendQuota?.MaxSendRate ?? 1,
		sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
		sendingEnabled: account.SendingEnabled !== false,
		enforcement: account.EnforcementStatus,
	};
}

type Identity = {
	VerifiedForSendingStatus?: boolean;
	DkimAttributes?: { Status?: string; SigningEnabled?: boolean };
	MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
};

async function dmarcRecord(domain: string): Promise<boolean> {
	for (const name of [domain, organisationalDomain(domain)]) {
		if (!name) continue;
		if ((await queryDns(`_dmarc.${name}`, "TXT")).some((record) => record.replace(/"/g, "").trim().toLowerCase().startsWith("v=dmarc1"))) return true;
	}
	return false;
}

/** R1 and R2: every item must pass before a marketing message may leave. */
export async function checkSender(env: CloudflareEnv, db: D1Database, settings: SenderSettings): Promise<Check[]> {
	const domain = settings.fromEmail.slice(settings.fromEmail.lastIndexOf("@") + 1);
	const checks: Check[] = [];
	const add = (id: string, label: string, ok: boolean, problem: string) => checks.push({ id, label, ok, detail: ok ? "" : problem });

	add("domain", "Domínio exclusivo de marketing", !(await isMailDomain(env, domain)), `${domain} é usado no e-mail do dia a dia. Use um subdomínio só para marketing.`);

	const config = await getAwsConfig(env);
	if (!config) {
		add("aws", "Credenciais da AWS", false, "Cadastre as credenciais na aba Envio, no quadro Conta Amazon SES.");
		return checks;
	}
	let identity: Identity | null = null;
	try {
		identity = await awsJson<Identity>(api(config, `/v2/email/identities/${encodeURIComponent(domain)}`));
	} catch (error) {
		if (!(error instanceof AwsError && error.status === 404)) {
			add("aws", "Acesso ao Amazon SES", false, error instanceof Error ? error.message : "Falha ao consultar a AWS.");
			return checks;
		}
	}
	add("identity", "Domínio verificado no SES", !!identity?.VerifiedForSendingStatus, `Cadastre e verifique ${domain} no Amazon SES.`);
	add("dkim", "DKIM do subdomínio", identity?.DkimAttributes?.Status === "SUCCESS" && identity.DkimAttributes.SigningEnabled !== false, "O DKIM do domínio ainda não foi confirmado.");
	const mailFrom = identity?.MailFromAttributes;
	add("spf", "SPF alinhado (MAIL FROM)", mailFrom?.MailFromDomainStatus === "SUCCESS" && !!mailFrom.MailFromDomain?.endsWith(`.${domain}`), "Configure um MAIL FROM personalizado neste domínio.");
	let dmarc = false;
	try { dmarc = await dmarcRecord(domain); } catch { dmarc = false; }
	add("dmarc", "Registro DMARC", dmarc, "Não foi encontrado um registro DMARC.");
	const feed = await readSetting<SesFeed>(db, "ses_feed");
	add("events", "Aviso de devoluções e reclamações", !!feed?.confirmed && feed.publishing, "Use o botão Configurar eventos e aguarde alguns segundos pela confirmação da AWS.");
	return checks;
}

const ignoreExisting = (error: unknown) => {
	if (!(error instanceof AwsError && error.code === "AlreadyExistsException")) throw error;
};

/** Creates the configuration set, the SNS topic and its subscription to this installation. Safe to repeat. */
export async function setupSesFeed(config: AwsConfig, db: D1Database, origin: string): Promise<void> {
	await awsJson({ ...api(config, "/v2/email/configuration-sets"), method: "POST", json: { ConfigurationSetName: CONFIGURATION_SET } }).catch(ignoreExisting);
	const topicArn = await createTopic(config, TOPIC);
	const previous = await readSetting<SesFeed>(db, "ses_feed");
	const token = previous?.token ?? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
	const endpoint = `${origin}/api/marketing/ses-events?token=${token}`;
	const same = previous?.endpoint === endpoint && previous.topicArn === topicArn;
	// Stored before subscribing: SNS calls the endpoint to confirm while this request is still running.
	await writeSetting(db, "ses_feed", { token, topicArn, endpoint, confirmed: same && previous.confirmed, publishing: false });
	await subscribeHttps(config, topicArn, endpoint);
	const destination = { Enabled: true, MatchingEventTypes: ["BOUNCE", "COMPLAINT", "DELIVERY"], SnsDestination: { TopicArn: topicArn } };
	await awsJson({ ...api(config, `/v2/email/configuration-sets/${CONFIGURATION_SET}/event-destinations`), method: "POST", json: { EventDestinationName: "sns", EventDestination: destination } }).catch(ignoreExisting);
	// Read again: the confirmation may have arrived meanwhile.
	await writeSetting(db, "ses_feed", { ...(await readSetting<SesFeed>(db, "ses_feed"))!, publishing: true });
}
