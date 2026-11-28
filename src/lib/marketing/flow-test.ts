/**
 * "Testar" in a funnel: the owner signs up with their own data, as a lead would, and the live funnel
 * walks them. The same person can repeat it, which a real passage never allows.
 */
import { importContacts } from "./contacts";
import { isValidEmail, normalizeEmail } from "./contacts-utils";
import { dropSetting, readSetting, writeSetting } from "./engine";
import type { FlowTestOpen, FlowTestStatus } from "./flows-types";
import { firstStep, readGraph, STEP_LABELS } from "./flows-utils";
import { readPhone } from "./whatsapp";

type Row = { name: string; list_id: string; steps: string; status: string; trigger_tag: string; goal_tag: string };
const getFlow = (db: D1Database, id: string) => db.prepare("SELECT name, list_id, steps, status, trigger_tag, goal_tag FROM marketing_flows WHERE id = ?").bind(id).first<Row>();
const prefix = (flowId: string) => `flow:${flowId}:`;
/** Who is testing this funnel, kept until "Encerrar teste" so it survives leaving the screen. */
const testKey = (flowId: string) => `flow_test:${flowId}`;

export async function startFlowTest(db: D1Database, flowId: string, input: { name?: unknown; email?: unknown; phone?: unknown }, now = Date.now()): Promise<{ error: string } | { error: null }> {
	const flow = await getFlow(db, flowId);
	if (!flow) return { error: "Funil não encontrado." };
	if (flow.status !== "active") return { error: "Ative o funil antes de testar." };
	const email = normalizeEmail(String(input.email ?? ""));
	if (!isValidEmail(email)) return { error: "Confira o e-mail digitado." };
	const graph = readGraph(flow.steps);
	const typed = String(input.phone ?? "").trim();
	const phone = typed ? readPhone(typed) : null;
	if (typed && !phone) return { error: "Informe o WhatsApp com DDD, por exemplo 11 99999-9999." };
	if (!phone && graph.nodes.some((node) => node.type === "whatsapp")) return { error: "Este funil usa WhatsApp: informe o seu número." };

	const name = String(input.name ?? "").trim().slice(0, 120);
	const report = await importContacts(db, [{ line: 1, email, name, fields: {} }], { listId: flow.list_id, consent: { source: "teste do funil", text: "Cadastro de teste feito pelo administrador com os próprios dados.", consentedAt: now }, origin: "teste do funil", now });
	// A blocked or unsubscribed address stays that way, for tests too.
	if (report.rejected.length) return { error: `Não foi possível testar com este e-mail: ${report.rejected[0].reason}.` };
	const contact = (await db.prepare("SELECT id FROM marketing_contacts WHERE email = ?").bind(email).first<{ id: string }>())!;
	if (!(await db.prepare("SELECT 1 AS ok FROM marketing_list_members WHERE list_id = ? AND contact_id = ? AND unsubscribed_at IS NULL").bind(flow.list_id, contact.id).first())) {
		return { error: "Este e-mail saiu desta lista. Use outro para testar." };
	}
	if (phone) {
		await db.prepare(`INSERT INTO marketing_whatsapp (contact_id, phone, source, text, consented_at) VALUES (?, ?, 'teste do funil', 'Número informado pelo administrador para teste.', ?)
			ON CONFLICT (contact_id) DO UPDATE SET phone = excluded.phone, source = excluded.source, text = excluded.text, consented_at = excluded.consented_at WHERE marketing_whatsapp.opted_out_at IS NULL`)
			.bind(contact.id, phone, now).run();
		if (await db.prepare("SELECT 1 AS ok FROM marketing_whatsapp WHERE contact_id = ? AND opted_out_at IS NOT NULL").bind(contact.id).first()) {
			return { error: "O WhatsApp deste contato está parado. Use outro e-mail para testar." };
		}
	}

	// Start over: forget the earlier test of this funnel and the tags that would change the path.
	const first = firstStep(graph);
	const tags = [flow.goal_tag, ...graph.nodes.flatMap((node) => (node.type === "tag" ? [node.tag] : []))].filter((tag) => tag && tag !== flow.trigger_tag);
	await db.batch([
		db.prepare("DELETE FROM marketing_flow_runs WHERE flow_id = ? AND contact_id = ?").bind(flowId, contact.id),
		db.prepare("DELETE FROM marketing_whatsapp_sends WHERE flow_id = ? AND contact_id = ?").bind(flowId, contact.id),
		db.prepare("DELETE FROM marketing_sends WHERE contact_id = ?1 AND substr(campaign_id, 1, length(?2)) = ?2").bind(contact.id, prefix(flowId)),
		...tags.map((tag) => db.prepare("DELETE FROM marketing_contact_tags WHERE contact_id = ? AND tag = ?").bind(contact.id, tag)),
		...(flow.trigger_tag ? [db.prepare("INSERT OR IGNORE INTO marketing_contact_tags (contact_id, tag, created_at) VALUES (?, ?, ?)").bind(contact.id, flow.trigger_tag, now)] : []),
		db.prepare("INSERT INTO marketing_flow_runs (flow_id, contact_id, step_id, status, next_check_at, created_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(flowId, contact.id, first, now, now),
	]);
	await writeSetting(db, testKey(flowId), contact.id);
	return { error: null };
}

/** The test that is open for this funnel, with where it stands now. */
export async function currentFlowTest(db: D1Database, flowId: string): Promise<FlowTestOpen | null> {
	const contactId = await readSetting<string>(db, testKey(flowId));
	if (!contactId) return null;
	const person = await db.prepare(`SELECT c.email, c.name, COALESCE(w.phone, '') AS phone FROM marketing_contacts c LEFT JOIN marketing_whatsapp w ON w.contact_id = c.id WHERE c.id = ?`)
		.bind(contactId).first<{ email: string; name: string; phone: string }>();
	const test = person && (await flowTestStatus(db, flowId, person.email));
	return person && test ? { ...person, test } : null;
}

/** Forget the test. What had not left yet for that person does not leave any more. */
export async function stopFlowTest(db: D1Database, flowId: string): Promise<void> {
	const contactId = await readSetting<string>(db, testKey(flowId));
	if (contactId) await db.prepare("UPDATE marketing_flow_runs SET status = 'exited' WHERE flow_id = ? AND contact_id = ? AND status = 'active'").bind(flowId, contactId).run();
	await dropSetting(db, testKey(flowId));
}

const STOPPED: Record<string, string> = { done: "Chegou ao fim do funil.", goal: "Atingiu o objetivo e saiu.", exited: "Saiu do funil (descadastro ou bloqueio)." };

/** Where the test is, and what left or failed, step by step from the top of the drawing. */
export async function flowTestStatus(db: D1Database, flowId: string, address: string): Promise<FlowTestStatus | null> {
	const flow = await getFlow(db, flowId);
	const contact = await db.prepare("SELECT id FROM marketing_contacts WHERE email = ?").bind(normalizeEmail(address)).first<{ id: string }>();
	if (!flow || !contact) return null;
	const run = await db.prepare("SELECT step_id, status, wake_at FROM marketing_flow_runs WHERE flow_id = ? AND contact_id = ?").bind(flowId, contact.id).first<{ step_id: string | null; status: string; wake_at: number | null }>();
	if (!run) return null;
	const [mails, audios] = await Promise.all([
		db.prepare("SELECT campaign_id, status, error FROM marketing_sends WHERE contact_id = ?").bind(contact.id).all<{ campaign_id: string; status: string; error: string }>(),
		db.prepare("SELECT step_id, status, error FROM marketing_whatsapp_sends WHERE flow_id = ? AND contact_id = ?").bind(flowId, contact.id).all<{ step_id: string; status: string; error: string }>(),
	]);
	const steps: FlowTestStatus["steps"] = [];
	for (const node of [...readGraph(flow.steps).nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
		if (node.type !== "email" && node.type !== "whatsapp") continue;
		const sent = node.type === "email"
			? mails.results.find((item) => item.campaign_id === prefix(flowId) + node.id)
			: audios.results.find((item) => item.step_id === node.id);
		const name = node.name || STEP_LABELS[node.type];
		if (!sent) steps.push({ name, text: "ainda não saiu", tone: "wait" });
		else if (sent.status === "sent") steps.push({ name, text: "enviado", tone: "ok" });
		else if (sent.status === "pending" || sent.status === "sending") steps.push({ name, text: sent.error ? `na fila: ${sent.error}` : "na fila", tone: "wait" });
		else steps.push({ name, text: `não saiu: ${sent.error || sent.status}`, tone: "error" });
	}
	let now = STOPPED[run.status] ?? "Em andamento.";
	if (run.status === "active") {
		const at = readGraph(flow.steps).nodes.find((node) => node.id === run.step_id);
		if (at?.type === "wait" && run.wake_at) now = `Esperando até ${new Date(run.wake_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
		else if (at?.type === "whatsapp") now = "Esperando para mandar no WhatsApp. Ele sai das 8h às 20h, com o WhatsApp conectado.";
		else if (at?.type === "email") now = "Esperando o e-mail sair.";
	}
	return { now, done: run.status !== "active", steps };
}
