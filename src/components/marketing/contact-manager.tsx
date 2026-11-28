"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContactDetail, ContactStatus, ContactSummary, ImportReport, MailingList, Rejection } from "@/lib/marketing/contacts-types";
import { chunkImportRows, parseImportCsv } from "@/lib/marketing/contacts-utils";
import { marketingRequest } from "./marketing-request";

const STATUS: Record<ContactStatus, { label: string; className: string }> = {
	subscribed: { label: "Autorizado", className: "bg-green-100 text-green-800" },
	no_consent: { label: "Sem consentimento", className: "bg-amber-100 text-amber-800" },
	unsubscribed: { label: "Descadastrado", className: "bg-neutral-200 text-neutral-700" },
	blocked: { label: "Bloqueado", className: "bg-red-100 text-red-800" },
};

const SELECT = "h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const today = () => new Date().toISOString().slice(0, 10);
const day = (time: number) => new Date(time).toLocaleDateString("pt-BR", { timeZone: "UTC" });

function Field({ label, value, onChange, type, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
	return (
		<label className="block flex-1 space-y-1">
			<span className="block text-xs font-medium text-neutral-600">{label}</span>
			<Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
		</label>
	);
}

type ConsentForm = { source: string; text: string; date: string };
const emptyConsent = (): ConsentForm => ({ source: "", text: "", date: today() });

function ConsentFields({ value, onChange }: { value: ConsentForm; onChange: (value: ConsentForm) => void }) {
	return (
		<div className="flex flex-wrap gap-2">
			<Field label="Origem da autorização" value={value.source} placeholder="Ex.: compra no site" onChange={(source) => onChange({ ...value, source })} />
			<Field label="O que a pessoa aceitou" value={value.text} placeholder="Ex.: Quero receber novidades por e-mail" onChange={(text) => onChange({ ...value, text })} />
			<Field label="Data" type="date" value={value.date} onChange={(date) => onChange({ ...value, date })} />
		</div>
	);
}

export function ContactManager() {
	const [lists, setLists] = useState<MailingList[]>([]);
	const [contacts, setContacts] = useState<ContactSummary[]>([]);
	const [total, setTotal] = useState(0);
	const [filter, setFilter] = useState({ q: "", list: "", tag: "", status: "", offset: 0 });
	const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [person, setPerson] = useState({ email: "", name: "", listId: "" });
	const [personConsent, setPersonConsent] = useState(emptyConsent);
	const [file, setFile] = useState<File | null>(null);
	const [importList, setImportList] = useState("");
	const [importConsent, setImportConsent] = useState(emptyConsent);
	const [declared, setDeclared] = useState(false);
	const [rejected, setRejected] = useState<Rejection[]>([]);
	const [detail, setDetail] = useState<ContactDetail | null>(null);

	const load = useCallback(() => {
		const query = new URLSearchParams(Object.entries(filter).map(([key, value]) => [key, String(value)]).filter(([, value]) => value && value !== "0"));
		void Promise.all([
			marketingRequest<{ lists: MailingList[] }>("/api/marketing/lists"),
			marketingRequest<{ contacts: ContactSummary[]; total: number }>(`/api/marketing/contacts?${query}`),
		])
			.then(([listData, contactData]) => {
				setLists(listData.lists);
				setLoaded(true);
				setContacts(contactData.contacts);
				setTotal(contactData.total);
			})
			.catch((error: Error) => setMessage({ error: true, text: error.message }));
	}, [filter]);
	useEffect(load, [load]);

	async function run(action: () => Promise<string>) {
		setBusy(true);
		setMessage(null);
		try {
			setMessage({ error: false, text: await action() });
			load();
		} catch (error) {
			setMessage({ error: true, text: (error as Error).message });
		} finally {
			setBusy(false);
		}
	}

	const addPerson = () => run(async () => {
		const consent = personConsent.source.trim() || personConsent.text.trim() ? personConsent : undefined;
		await marketingRequest("/api/marketing/contacts", json("POST", { ...person, consent }));
		setPerson({ email: "", name: "", listId: person.listId });
		return consent ? "Contato salvo." : "Contato salvo sem consentimento: ele não receberá campanhas.";
	});

	const importFile = () => run(async () => {
		if (!file) throw new Error("Escolha o arquivo CSV.");
		const parsed = parseImportCsv(await file.text());
		if ("error" in parsed) throw new Error(parsed.error);
		if (!parsed.rows.length) throw new Error("O arquivo não tem contatos.");
		setRejected([]);
		let added = 0;
		let updated = 0;
		const refused: Rejection[] = [];
		for (const rows of chunkImportRows(parsed.rows)) {
			const { report } = await marketingRequest<{ report: ImportReport }>("/api/marketing/contacts/import", json("POST", { rows, listId: importList, consent: importConsent, declared }));
			added += report.added;
			updated += report.updated;
			refused.push(...report.rejected);
			setRejected([...refused]);
			setMessage({ error: false, text: `Importando… ${added + updated + refused.length} de ${parsed.rows.length}` });
		}
		return `Importação concluída: ${added} novos, ${updated} já existentes, ${refused.length} recusados.`;
	});

	const open = (id: string) => run(async () => {
		setDetail((await marketingRequest<{ contact: ContactDetail }>(`/api/marketing/contacts/${id}`)).contact);
		return "";
	});

	const saveDetail = () => run(async () => {
		if (!detail) return "";
		await marketingRequest(`/api/marketing/contacts/${detail.id}`, json("PUT", { name: detail.name, tags: detail.tags, listIds: detail.lists.map((list) => list.id) }));
		setDetail(null);
		return "Contato atualizado.";
	});

	const stopWhatsApp = (id: string) => run(async () => {
		setDetail((await marketingRequest<{ contact: ContactDetail }>(`/api/marketing/contacts/${id}`, json("PATCH", { action: "stop_whatsapp" }))).contact);
		return "WhatsApp desativado para este contato.";
	});

	const erase = (contact: ContactSummary) => {
		if (!window.confirm(`Apagar todos os dados de ${contact.email}? Não dá para desfazer. O endereço poderá ser cadastrado de novo, a menos que tenha pedido descadastro, devolvido ou reclamado.`)) return;
		void run(async () => {
			await marketingRequest(`/api/marketing/contacts/${contact.id}`, { method: "DELETE" });
			setDetail(null);
			return "Dados apagados.";
		});
	};

	// The browser saves the file itself; nothing is sent anywhere.
	function download(contact: ContactDetail) {
		const url = URL.createObjectURL(new Blob([JSON.stringify(contact, null, 2)], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `contato-${contact.id}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	const listOptions = lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>);

	return (
		<div className="space-y-6">
			{message?.text && <p role="status" className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>}

			{loaded && lists.length === 0 && <p className="text-sm text-neutral-500">Você ainda não tem lista. <Link className="text-blue-700 underline" href="/marketing/listas">Criar nova lista</Link></p>}

			<details className="rounded-3xl bg-white p-6">
				<summary className="cursor-pointer text-sm font-medium text-neutral-900">Adicionar um contato</summary>
				<div className="mt-3 space-y-3">
					<div className="flex flex-wrap items-end gap-2">
						<Field label="E-mail" type="email" value={person.email} onChange={(email) => setPerson({ ...person, email })} />
						<Field label="Nome" value={person.name} onChange={(name) => setPerson({ ...person, name })} />
						<select aria-label="Lista do contato" className={SELECT} value={person.listId} onChange={(event) => setPerson({ ...person, listId: event.target.value })}>
							<option value="">Sem lista</option>
							{listOptions}
						</select>
					</div>
					<ConsentFields value={personConsent} onChange={setPersonConsent} />
					<p className="text-xs text-neutral-500">Sem origem e texto, o contato é salvo como "sem consentimento" e não recebe campanhas.</p>
					<Button type="button" disabled={busy || !person.email.trim()} onClick={() => void addPerson()}>Salvar contato</Button>
				</div>
			</details>

			<details className="rounded-3xl bg-white p-6">
				<summary className="cursor-pointer text-sm font-medium text-neutral-900">Importar arquivo CSV</summary>
				<div className="mt-3 space-y-3">
					<p className="text-xs text-neutral-500">A primeira linha precisa ter a coluna "email". A coluna "nome" é opcional; as demais viram campos do contato.</p>
					<div className="flex flex-wrap items-center gap-2">
						<input type="file" accept=".csv,text/csv" aria-label="Arquivo CSV" className="text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
						<select aria-label="Lista de destino" className={SELECT} value={importList} onChange={(event) => setImportList(event.target.value)}>
							<option value="">Escolha a lista</option>
							{listOptions}
						</select>
					</div>
					<ConsentFields value={importConsent} onChange={setImportConsent} />
					<label className="flex gap-2 text-sm text-neutral-700">
						<input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} />
						Confirmo que essas pessoas autorizaram o envio e que a lista não foi comprada nem coletada.
					</label>
					<Button type="button" disabled={busy || !file || !importList || !declared} onClick={() => void importFile()}>Importar</Button>
					{rejected.length > 0 && (
						<div className="max-h-48 overflow-y-auto rounded-xl bg-neutral-50 p-3 text-xs text-neutral-700">
							{rejected.map((item, index) => <p key={index}>Linha {item.line} · {item.email || "(vazio)"}: {item.reason}</p>)}
						</div>
					)}
				</div>
			</details>

			<section className="space-y-3 rounded-3xl bg-white p-6">
				<Label>Contatos ({total})</Label>
				<div className="flex flex-wrap items-end gap-2">
					<Field label="Buscar" value={filter.q} placeholder="nome ou e-mail" onChange={(q) => setFilter({ ...filter, q, offset: 0 })} />
					<Field label="Etiqueta" value={filter.tag} onChange={(tag) => setFilter({ ...filter, tag, offset: 0 })} />
					<select aria-label="Filtrar por lista" className={SELECT} value={filter.list} onChange={(event) => setFilter({ ...filter, list: event.target.value, offset: 0 })}>
						<option value="">Todas as listas</option>
						{listOptions}
					</select>
					<select aria-label="Filtrar por situação" className={SELECT} value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value, offset: 0 })}>
						<option value="">Todas as situações</option>
						{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
					</select>
				</div>
				<ul className="divide-y divide-neutral-100">
					{contacts.map((contact) => (
						<li key={contact.id} className="space-y-2 py-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="min-w-0">
									<span className="block break-all text-sm font-medium text-neutral-900">{contact.email}</span>
									<span className="block text-xs text-neutral-500">{[contact.name, contact.lists.map((list) => list.unsubscribed ? `${list.name} (saiu)` : list.name).join(", "), contact.tags.join(", ")].filter(Boolean).join(" · ")}</span>
								</span>
								<span className="flex items-center gap-2">
									<span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[contact.status].className}`}>{STATUS[contact.status].label}</span>
									<Button type="button" size="sm" variant="outline" onClick={() => void open(contact.id)}>Abrir</Button>
									<Button type="button" size="sm" variant="outline" onClick={() => erase(contact)}>Apagar</Button>
								</span>
							</div>
							{detail?.id === contact.id && (
								<div className="space-y-3 rounded-xl bg-neutral-50 p-4">
									<div className="flex flex-wrap gap-2">
										<Field label="Nome" value={detail.name} onChange={(name) => setDetail({ ...detail, name })} />
										<Field label="Etiquetas (separadas por vírgula)" value={detail.tags.join(",")} onChange={(tags) => setDetail({ ...detail, tags: tags.split(",") })} />
									</div>
									<fieldset className="flex flex-wrap gap-3 text-sm">
										<legend className="text-xs font-medium text-neutral-600">Listas</legend>
										{lists.map((list) => (
											<label key={list.id} className="flex gap-1">
												<input
													type="checkbox"
													checked={detail.lists.some((item) => item.id === list.id)}
													onChange={(event) => setDetail({ ...detail, lists: event.target.checked ? [...detail.lists, { id: list.id, name: list.name, unsubscribed: false }] : detail.lists.filter((item) => item.id !== list.id) })}
												/>
												{list.name}
											</label>
										))}
									</fieldset>
									{Object.entries(detail.fields).map(([key, value]) => <p key={key} className="text-xs text-neutral-600">{key}: {value}</p>)}
									{detail.whatsapp && (
										<div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
											<span>WhatsApp: {detail.whatsapp.phone} · {detail.whatsapp.optedOutAt ? `parado em ${day(detail.whatsapp.optedOutAt)}` : `autorizado em ${day(detail.whatsapp.consentedAt)}: "${detail.whatsapp.text}"`}</span>
											{!detail.whatsapp.optedOutAt && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void stopWhatsApp(detail.id)}>Parar WhatsApp</Button>}
										</div>
									)}
									<div className="text-xs text-neutral-600">
										<p className="font-medium">Consentimento</p>
										{detail.consents.length === 0 && <p>Nenhum registrado.</p>}
										{detail.consents.map((consent, index) => <p key={index}>{day(consent.consentedAt)} · {consent.source}: "{consent.text}"</p>)}
										<p className="mt-2 font-medium">Histórico</p>
										{detail.events.map((event, index) => <p key={index}>{new Date(event.createdAt).toLocaleString("pt-BR")} · {event.type} {event.detail}</p>)}
									</div>
									<div className="flex flex-wrap gap-2">
										<Button type="button" size="sm" disabled={busy} onClick={() => void saveDetail()}>Salvar</Button>
										<Button type="button" size="sm" variant="outline" onClick={() => download(detail)}>Exportar dados</Button>
										<Button type="button" size="sm" variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
									</div>
								</div>
							)}
						</li>
					))}
					{contacts.length === 0 && <li className="py-3 text-sm text-neutral-500">Nenhum contato encontrado.</li>}
				</ul>
				{total > 50 && (
					<div className="flex gap-2">
						<Button type="button" size="sm" variant="outline" disabled={filter.offset === 0} onClick={() => setFilter({ ...filter, offset: Math.max(filter.offset - 50, 0) })}>Anteriores</Button>
						<Button type="button" size="sm" variant="outline" disabled={filter.offset + 50 >= total} onClick={() => setFilter({ ...filter, offset: filter.offset + 50 })}>Próximos</Button>
					</div>
				)}
			</section>
		</div>
	);
}
