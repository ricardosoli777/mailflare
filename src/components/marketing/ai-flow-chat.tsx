"use client";

// A conversation that ends in a draft funnel with its e-mails written. Nothing is activated here.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Square, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { AiAnswer, AiDocument, AiFile, AiFunnel, AiMessage, AiStep } from "@/lib/marketing/ai-types";
import { AI_PROVIDERS, documentsProblem } from "@/lib/marketing/ai-utils";
import { waitText } from "@/lib/marketing/flows-utils";
import { readAiSettings, type AiSettings } from "./ai-store";
import { marketingRequest } from "./marketing-request";
import { ACCEPTED_FILES, readDocument } from "./read-document";
import { useDictation } from "./use-dictation";

const EXAMPLES = "Ex.: Funil de boas-vindas para quem baixou meu e-book de receitas. Quero 3 e-mails e, no último, convidar para o curso (https://meusite.com/curso).";

function Steps({ steps }: { steps: AiStep[] }) {
	return (
		<ol className="space-y-2">
			{steps.map((step, index) => (
				<li key={index} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">
					{step.type === "wait" ? `Esperar ${waitText(step.amount, step.unit)}`
						: step.type === "tag" ? `${step.action === "add" ? "Colocar" : "Tirar"} a etiqueta "${step.tag}"`
							: step.type === "email" ? (
								<details>
									<summary className="cursor-pointer"><strong>E-mail:</strong> {step.subject}</summary>
									<div className="mt-2 space-y-2 text-neutral-700">
										{step.blocks.map((block, position) => (block.type === "divider" ? <hr key={position} />
											// eslint-disable-next-line @next/next/no-img-element
											: block.type === "image" ? <img key={position} src={block.url} alt={block.alt} className="max-h-40 rounded-lg" />
											: block.type === "button" ? <p key={position} className="break-all text-blue-700">Botão &quot;{block.label}&quot; → {block.url}</p>
												: <p key={position} className={`whitespace-pre-wrap ${block.type === "heading" ? "font-semibold" : ""}`}>{block.text}</p>))}
									</div>
								</details>
							) : (
								<div className="space-y-2">
									<p><strong>Condição:</strong> {step.test === "opened" ? "abriu o e-mail?" : step.test === "clicked" ? "clicou no e-mail?" : `tem a etiqueta "${step.tag}"?`}</p>
									{([["Sim", step.yes], ["Não", step.no]] as const).map(([label, side]) => (
										<div key={label} className="border-l-2 border-neutral-200 pl-3">
											<p className="text-xs font-medium text-neutral-500">{label}</p>
											{side.length ? <Steps steps={side} /> : <p className="text-xs text-neutral-500">Segue em frente.</p>}
										</div>
									))}
								</div>
							)}
				</li>
			))}
		</ol>
	);
}

export function AiFlowChat({ listId, onCreated }: { listId: string; onCreated: (id: string) => Promise<void> }) {
	const [settings, setSettings] = useState<AiSettings | null>(null);
	const [messages, setMessages] = useState<AiMessage[]>([]);
	const [funnel, setFunnel] = useState<AiFunnel | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState<"" | "asking" | "creating">("");

	const [files, setFiles] = useState<AiFile[]>([]);
	const [documents, setDocuments] = useState<AiDocument[]>([]);
	const [uploading, setUploading] = useState(false);
	const picker = useRef<HTMLInputElement>(null);
	const dictation = useDictation((words) => setDraft((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${words}`.slice(0, 4000)), setError);

	async function attach(chosen: File[]) {
		setError("");
		setUploading(true);
		try {
			let material = documents;
			for (const file of chosen) {
				if (/^image\//.test(file.type)) {
					const form = new FormData();
					form.set("file", file);
					const { url } = await marketingRequest<{ url: string }>("/api/marketing/assets", { method: "POST", body: form });
					setFiles((current) => [...current, { name: file.name, url }].slice(0, 10));
					continue;
				}
				const next = [...material, await readDocument(file)];
				const problem = documentsProblem(next);
				if (problem) throw new Error(problem);
				material = next;
				setDocuments(material);
			}
		} catch (uploadError) {
			setError((uploadError as Error).message);
		} finally {
			setUploading(false);
		}
	}

	useEffect(() => {
		void readAiSettings().then(setSettings).catch(() => setSettings({ active: "", providers: {} }));
	}, []);

	const provider = settings?.active || "";
	const config = provider ? settings?.providers[provider] : undefined;
	const ready = !!config?.key && !!config.model;

	async function ask() {
		const content = draft.trim();
		if (!content || !ready || uploading) return;
		dictation.stop();
		const next: AiMessage[] = [...messages, { role: "user", content }];
		setMessages(next);
		setDraft("");
		setError("");
		setBusy("asking");
		try {
			const answer = await marketingRequest<AiAnswer>("/api/marketing/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, key: config.key, model: config.model, messages: next, funnel, files, documents }) });
			setMessages([...next, { role: "assistant", content: answer.reply }]);
			if (answer.funnel) setFunnel(answer.funnel);
		} catch (askError) {
			// The message goes back to the box so it can be sent again.
			setMessages(messages);
			setDraft(content);
			setError((askError as Error).message);
		} finally {
			setBusy("");
		}
	}

	async function create() {
		setBusy("creating");
		setError("");
		try {
			const { id } = await marketingRequest<{ id: string }>("/api/marketing/ai/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ funnel, listId }) });
			setMessages([]);
			setFunnel(null);
			setFiles([]);
			setDocuments([]);
			await onCreated(id);
		} catch (createError) {
			setError((createError as Error).message);
		} finally {
			setBusy("");
		}
	}

	return (
		<section className="space-y-3 rounded-3xl bg-white p-6">
			<h2 className="text-base font-semibold">Criar com IA</h2>
			<p className="text-sm text-neutral-500">Conte o que você oferece, para quem e o objetivo. A IA monta o fluxo e escreve os e-mails. Você revisa antes de criar.</p>
			{settings && !ready && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Abra <Link href="/marketing/ia" className="font-semibold underline">IA</Link> no menu, cole a sua chave e escolha o modelo.</p>}
			{ready && <p className="text-xs text-neutral-500">Usando {AI_PROVIDERS.find((item) => item.id === provider)?.label} · {config.model}</p>}
			{messages.length > 0 && (
				<div className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
					{messages.map((message, index) => (
						<p key={index} className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${message.role === "user" ? "ml-8 bg-blue-600 text-white" : "mr-8 bg-neutral-100"}`}>{message.content}</p>
					))}
				</div>
			)}
			{busy === "asking" && <p role="status" className="text-sm text-neutral-500">Escrevendo… pode levar um minuto.</p>}
			{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
			{funnel && (
				<div className="space-y-3 rounded-2xl bg-neutral-50 p-4">
					<h3 className="text-sm font-semibold">Proposta: {funnel.name}</h3>
					<Steps steps={funnel.steps} />
					<p className="text-xs text-neutral-500">Confira textos, links e promessas. O funil é criado como rascunho: nada é enviado até você ativar.</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" disabled={!!busy} onClick={() => void create()}>{busy === "creating" ? "Criando…" : "Criar este funil"}</Button>
						<Button type="button" variant="ghost" disabled={!!busy} onClick={() => {
							setFunnel(null);
							setMessages([]);
							setFiles([]);
							setDocuments([]);
						}}>Começar de novo</Button>
					</div>
				</div>
			)}
			<form className="space-y-2" onSubmit={(event) => {
				event.preventDefault();
				void ask();
			}}>
				<textarea className="min-h-24 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm" maxLength={4000} value={draft} aria-label="Mensagem para a IA" placeholder={funnel ? "Peça ajustes. Ex.: deixe o segundo e-mail mais curto." : EXAMPLES} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !busy) {
						event.preventDefault();
						void ask();
					}
				}} />
				{documents.length > 0 && (
					<ul className="flex flex-wrap gap-2" aria-label="Documentos para a IA ler">
						{documents.map((document, index) => (
							<li key={`${document.name}-${index}`} className="flex items-center gap-2 rounded-full border border-neutral-200 py-1 pl-1 pr-2 text-xs">
								<span className="rounded-full bg-neutral-100 px-2 py-1 font-medium">Ler</span>
								<span className="max-w-40 truncate">{document.name}</span>
								<button type="button" aria-label={`Remover ${document.name}`} onClick={() => setDocuments((current) => current.filter((item) => item !== document))}><X className="h-3.5 w-3.5" /></button>
							</li>
						))}
					</ul>
				)}
				{files.length > 0 && (
					<ul className="flex flex-wrap gap-2" aria-label="Imagens para os e-mails">
						{files.map((file) => (
							<li key={file.url} className="flex items-center gap-2 rounded-full border border-neutral-200 py-1 pl-1 pr-2 text-xs">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={file.url} alt="" className="h-7 w-7 rounded-full object-cover" />
								<span className="max-w-40 truncate">{file.name}</span>
								<button type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.url !== file.url))}><X className="h-3.5 w-3.5" /></button>
							</li>
						))}
					</ul>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<Button type="button" size="sm" variant="outline" aria-label="Anexar arquivo" title="Anexar documento ou imagem" disabled={uploading} onClick={() => picker.current?.click()}><Paperclip className="h-4 w-4" /></Button>
					<input ref={picker} type="file" multiple accept={ACCEPTED_FILES} aria-label="Documentos e imagens" className="hidden" onChange={(event) => {
						const chosen = [...(event.target.files ?? [])];
						event.target.value = "";
						void attach(chosen);
					}} />
					{dictation.supported && (
						<Button type="button" size="sm" variant={dictation.listening ? "destructive" : "outline"} aria-label={dictation.listening ? "Parar de ouvir" : "Falar"} aria-pressed={dictation.listening} title="Falar em vez de digitar" onClick={dictation.toggle}>
							{dictation.listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
						</Button>
					)}
					<Button type="submit" disabled={!ready || !!busy || uploading || !draft.trim()}>Enviar</Button>
					{uploading && <span role="status" className="text-xs text-neutral-500">Lendo arquivo…</span>}
					{dictation.listening && <span role="status" className="text-xs text-red-700">Ouvindo… fale e clique no quadrado para parar.</span>}
				</div>
				<p className="text-xs text-neutral-500">Documentos (PDF, Word, TXT) são lidos pela IA para escrever os e-mails: vão ao provedor a cada mensagem e não ficam guardados no MailLead. Imagens (até 2 MB) entram nos e-mails e ficam em endereço público.</p>
			</form>
		</section>
	);
}
