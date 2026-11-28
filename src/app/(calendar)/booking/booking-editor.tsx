"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Mail, MoreVertical, Pencil, Plus, Trash2, UserRound } from "@/components/icons";
import { BOOKING_TEMPLATE_PLACEHOLDERS, CONFIRMATION_BODY_MAX, CONFIRMATION_SUBJECT_MAX, defaultConfirmation } from "@/lib/booking/confirmation-utils";
import clsx from "clsx";
import { DialogFrame } from "@/components/dialog-frame";
import { useLanguage } from "@/components/language-provider";
import { folderColorKeys } from "@/lib/folders/color-keys";
import type { TranslationKey } from "@/lib/i18n/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FOLDER_COLOR_OPTIONS } from "@/lib/folders/colors";
import { slugifyBookingName } from "@/lib/booking/utils";
import type { BookingEditorProps } from "./editor-types";
import type { BookingEditorSection } from "./types";
import { bookingFormWithName, matchBookingHost, nextBookingTimeRange, WEEKDAYS } from "./utils";
import { BookingHostAvatar } from "./booking-host-avatar";

const TABS = [
	{ id: "details", icon: Pencil },
	{ id: "availability", icon: CalendarDays },
	{ id: "emails", icon: Mail },
] as const;
const LENGTHS = [15, 30, 45, 60];
const cardClass = "space-y-2 rounded-2xl border border-neutral-200 p-4";
const labelClass = "block text-sm font-semibold text-neutral-900";
const segment = (active: boolean) => clsx("rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900");

export function BookingEditor({ form, open, editingId, username, hosts, canManageHosts, currentUserId, saving, onChange, onClose, onSave, onDelete, onToggleEnabled, onClosed }: BookingEditorProps) {
	const { t, locale } = useLanguage();
	const builtIn = defaultConfirmation(locale);
	const [tab, setTab] = useState<BookingEditorSection>("details");
	const [customLength, setCustomLength] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [hostQuery, setHostQuery] = useState("");
	const [hostError, setHostError] = useState("");
	// Opening the editor, or switching it to another booking, starts from the first tab.
	const [shownFor, setShownFor] = useState({ editingId, open });
	if (shownFor.editingId !== editingId || shownFor.open !== open) {
		setShownFor({ editingId, open });
		if (open) { setTab("details"); setCustomLength(false); setMoreOpen(false); setHostQuery(""); setHostError(""); }
	}
	const custom = customLength || !LENGTHS.includes(form.durationMinutes);
	const confirmationBodyRef = useRef<HTMLTextAreaElement>(null);
	// Placeholder chips go where the cursor is in the message, or at its end.
	function insertPlaceholder(name: string) {
		const field = confirmationBodyRef.current;
		const token = `{${name}}`;
		const start = field?.selectionStart ?? form.confirmationBody.length;
		const end = field?.selectionEnd ?? start;
		onChange({ ...form, confirmationBody: form.confirmationBody.slice(0, start) + token + form.confirmationBody.slice(end) });
		requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start + token.length, start + token.length); });
	}
	const title = editingId ? form.name || t("booking.editor.newMeeting") : t("booking.types.new");

	return createPortal(
		<div className={clsx("fixed inset-0 z-[120] flex justify-end bg-black/40 transition-opacity duration-300 motion-reduce:transition-none", open ? "opacity-100" : "pointer-events-none opacity-0")} onPointerDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
			<DialogFrame label={title} onClose={() => { if (!saving) onClose(); }} onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === "translate" && !open) onClosed(); }}
				className={clsx("flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl transition-[translate] duration-300 ease-in-out motion-reduce:transition-none md:my-2 md:mr-2 md:h-[calc(100%-1rem)] md:rounded-2xl", open ? "translate-x-0" : "translate-x-full")}>
				<header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-5 py-3">
					<h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-neutral-900">{title}</h2>
					{editingId && <div className="relative" onBlur={(blur) => { if (!blur.currentTarget.contains(blur.relatedTarget)) setMoreOpen(false); }}>
						<button type="button" aria-label={t("booking.editor.more")} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)} className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"><MoreVertical className="h-4 w-4" /></button>
						{moreOpen && <div className="absolute right-0 top-10 z-20 w-40 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
							<button type="button" onClick={() => { setMoreOpen(false); onToggleEnabled(); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100">{form.enabled ? t("booking.turnOff") : t("booking.turnOn")}</button>
							<button type="button" onClick={() => { setMoreOpen(false); onDelete(); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">{t("common.delete")}</button>
						</div>}
					</div>}
					<button type="button" disabled={saving} onClick={onClose} className="h-9 shrink-0 rounded-lg bg-neutral-100 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50">{t("booking.editor.close")}</button>
					<Button type="button" disabled={saving} onClick={onSave} className="h-9 shrink-0 rounded-lg bg-blue-600 px-4 text-white hover:bg-blue-500">{saving ? t("common.saving") : editingId ? t("common.save") : t("booking.editor.create")}</Button>
				</header>
				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					<div role="tablist" aria-label={t("booking.editor.details")} className="flex shrink-0 gap-1 overflow-x-auto p-3 md:w-48 md:flex-col md:overflow-visible">
						{TABS.map(({ id, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={clsx("flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium", tab === id ? "bg-neutral-100 text-neutral-900" : "text-neutral-600 hover:bg-neutral-50")}><Icon className="h-4 w-4" />{t(`booking.editor.tab.${id}`)}</button>)}
					</div>
					<div role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
						{tab === "details" && <>
							<div className={cardClass}>
								<label className={labelClass} htmlFor="booking-name">{t("booking.editor.meetingName")}</label>
								<Input id="booking-name" value={form.name} onChange={(event) => onChange(bookingFormWithName(form, event.target.value))} placeholder={t("booking.editor.newMeeting")} maxLength={120} />
								<label className="flex flex-wrap items-center gap-x-1 text-sm text-neutral-500">
									<span className="break-all">/c/{username || t("booking.editor.yourName")}/</span>
									<input aria-label={t("booking.editor.slug")} value={form.slug} onChange={(event) => onChange({ ...form, slug: slugifyBookingName(event.target.value) })} placeholder={t("booking.editor.slugPlaceholder")} maxLength={80} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-neutral-900 outline-none hover:border-neutral-200 focus:border-blue-600" />
								</label>
								<div className="flex flex-wrap gap-2 pt-1" role="radiogroup" aria-label={t("booking.editor.color")}>{FOLDER_COLOR_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-label={t(folderColorKeys[option.value])} aria-checked={form.color === option.value} onClick={() => onChange({ ...form, color: option.value })} className={clsx("flex h-7 w-7 items-center justify-center rounded-full border-2 border-white ring-2", form.color === option.value ? "ring-neutral-800" : "ring-transparent hover:ring-neutral-300")} style={{ backgroundColor: option.value }}>{form.color === option.value && <span className="h-2 w-2 rounded-full bg-white" />}</button>)}</div>
							</div>
							<div className={cardClass}>
								<p className={labelClass}>{t("booking.editor.duration")}</p>
								<div role="group" aria-label={t("booking.editor.meetingLength")} className="inline-flex max-w-full flex-wrap rounded-xl bg-neutral-100 p-1">
									{LENGTHS.map((minutes) => <button key={minutes} type="button" aria-pressed={!custom && form.durationMinutes === minutes} onClick={() => { setCustomLength(false); onChange({ ...form, durationMinutes: minutes }); }} className={segment(!custom && form.durationMinutes === minutes)}>{t("booking.duration.min", { count: minutes })}</button>)}
									<button type="button" aria-pressed={custom} onClick={() => setCustomLength(true)} className={segment(custom)}>{t("booking.editor.custom")}</button>
								</div>
								{custom && <Input aria-label={t("booking.editor.customMinutes")} type="number" min={5} max={480} step={5} value={form.durationMinutes} onChange={(event) => onChange({ ...form, durationMinutes: Number(event.target.value) })} className="max-w-40" />}
							</div>
							<div className={cardClass}>
								<label className={labelClass} htmlFor="booking-location">{t("booking.editor.location")}</label>
								<Input id="booking-location" value={form.location} onChange={(event) => onChange({ ...form, location: event.target.value })} placeholder={t("booking.editor.locationPlaceholder")} maxLength={240} />
							</div>
							<div className={cardClass}>
								<p className={labelClass}>{t("booking.editor.host")}</p>
								<div className="space-y-2">{form.hostIds.map((id) => { const host = hosts.find((item) => item.id === id); const isCurrentUser = id === currentUserId; return <div key={id} className="flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2">{host ? <BookingHostAvatar host={host} currentUserId={currentUserId} /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-500"><UserRound className="h-4 w-4" /></span>}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-900">{host?.name || t("booking.editor.unavailableUser")}{isCurrentUser ? t("booking.editor.you") : ""}</span><span className="block truncate text-xs text-neutral-500">{host?.email}</span></span>{!isCurrentUser && <button type="button" onClick={() => onChange({ ...form, hostIds: form.hostIds.filter((hostId) => hostId !== id) })} className="text-xs font-medium text-neutral-500 hover:text-red-600">{t("resend.remove")}</button>}</div>; })}</div>
						{canManageHosts && <form onSubmit={(event) => { event.preventDefault(); const match = matchBookingHost(hosts, hostQuery, t); if (!match.host) { setHostError(match.error); return; } if (form.hostIds.includes(match.host.id)) { setHostError(t("booking.editor.alreadyHost")); return; } if (form.hostIds.length >= 20) { setHostError(t("booking.editor.maxHosts")); return; } onChange({ ...form, hostIds: [...form.hostIds, match.host.id] }); setHostQuery(""); setHostError(""); }}><label htmlFor="booking-host-input" className="block text-sm font-medium text-neutral-700">{t("booking.editor.addHost")}</label><div className="mt-2 flex gap-2"><Input id="booking-host-input" value={hostQuery} onChange={(event) => { setHostQuery(event.target.value); setHostError(""); }} placeholder={t("booking.editor.nameOrEmail")} autoComplete="off" aria-invalid={!!hostError} aria-describedby={hostError ? "booking-host-error" : undefined} className="min-w-0 flex-1" /><Button type="submit" variant="outline" className="shrink-0 rounded-full">{t("booking.editor.add")}</Button></div>{hostError && <p id="booking-host-error" role="alert" className="mt-2 text-xs text-red-600">{hostError}</p>}</form>}
							</div>
							<div className={cardClass}>
								<label className={labelClass} htmlFor="booking-description">{t("calendar.description")}</label>
								<Textarea id="booking-description" value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} placeholder={t("booking.editor.descriptionPlaceholder")} maxLength={2000} rows={6} className="resize-y" />
							</div>
						</>}
						{tab === "availability" && <>
							<div className={cardClass}>
								<p className={labelClass}>{t("booking.editor.availableDays")}</p>
								<div className="overflow-hidden rounded-xl border border-neutral-200">
									{[...WEEKDAYS.slice(1), WEEKDAYS[0]].map((day) => {
										const on = form.weekdays.includes(day);
										return <label key={day} className="flex cursor-pointer items-center gap-3 border-b border-neutral-200 px-3 py-2 text-sm last:border-b-0">
											<input type="checkbox" checked={on} onChange={() => onChange({ ...form, weekdays: on ? form.weekdays.filter((value) => value !== day) : [...form.weekdays, day].sort() })} className="h-4 w-4 accent-blue-600" />
											<span className={clsx("w-32 shrink-0 font-medium", on ? "text-neutral-900" : "text-neutral-400 line-through")}>{t(`weekday.${day}` as TranslationKey)}</span>
											<span className={clsx("min-w-0 flex-1 text-right", on ? "text-neutral-700" : "italic text-neutral-400")}>{on ? form.timeRanges.map((range) => `${range.startTime}–${range.endTime}`).join(", ") : t("calendar.closed")}</span>
										</label>;
									})}
								</div>
							</div>
							<div className={cardClass}>
								<p className={labelClass}>{t("booking.editor.times")}</p>
								<div className="mt-2 flex min-w-0 flex-col items-start space-y-2">{form.timeRanges.map((range, index) => <div key={index} className="flex items-end gap-2 w-full"><label className="min-w-0 flex-1 text-xs text-neutral-500">{t("calendar.from")}<Input type="time" step={900} value={range.startTime} onChange={(event) => onChange({ ...form, timeRanges: form.timeRanges.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item) })} className="mt-1 flex-1 min-w-0" /></label><label className="min-w-0 flex-1 text-xs text-neutral-500">{t("calendar.to")}<Input type="time" step={900} value={range.endTime} onChange={(event) => onChange({ ...form, timeRanges: form.timeRanges.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: event.target.value } : item) })} className="mt-1 flex-1 min-w-0" /></label><button type="button" aria-label={t("booking.editor.removeTime", { n: index + 1 })} disabled={form.timeRanges.length === 1} onClick={() => onChange({ ...form, timeRanges: form.timeRanges.filter((_, itemIndex) => itemIndex !== index) })} className="mb-1 rounded-full p-2 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}

						<button type="button" disabled={form.timeRanges.length >= 12} onClick={() => onChange({ ...form, timeRanges: [...form.timeRanges, nextBookingTimeRange(form.timeRanges, form.durationMinutes)] })} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600 disabled:opacity-50"><Plus className="h-4 w-4" />{t("booking.editor.addTime")}</button>
					</div>
								<p className="text-xs text-neutral-500">{t("booking.editor.timesUse", { zone: form.timeZone })}</p>
							</div>
						</>}
						{tab === "emails" && <div className={clsx(cardClass, "space-y-4")}>
							<p className={labelClass}>{t("booking.editor.confirmation")}</p>
							<p className="text-xs text-neutral-500">{t("booking.editor.confirmationHint")}</p>
						<label className="block text-sm font-medium text-neutral-700">{t("booking.editor.confirmationSubject")}<Input value={form.confirmationSubject} onChange={(event) => onChange({ ...form, confirmationSubject: event.target.value })} placeholder={builtIn.subject} maxLength={CONFIRMATION_SUBJECT_MAX} className="mt-2" /></label>
						<label className="block text-sm font-medium text-neutral-700">{t("booking.editor.confirmationBody")}<Textarea ref={confirmationBodyRef} value={form.confirmationBody} onChange={(event) => onChange({ ...form, confirmationBody: event.target.value })} placeholder={builtIn.body} maxLength={CONFIRMATION_BODY_MAX} rows={10} className="mt-2 resize-y" /></label>
						{(!form.confirmationSubject || !form.confirmationBody) && <Button type="button" variant="outline" onClick={() => onChange({ ...form, confirmationSubject: form.confirmationSubject || builtIn.subject, confirmationBody: form.confirmationBody || builtIn.body })} className="h-8 rounded-full px-3 text-xs">{t("booking.editor.confirmationUseDefault")}</Button>}
						<div><p className="text-xs font-medium text-neutral-700">{t("booking.editor.confirmationPlaceholders")}</p><div className="mt-2 flex flex-wrap gap-1.5">{BOOKING_TEMPLATE_PLACEHOLDERS.map((name) => <button key={name} type="button" onClick={() => insertPlaceholder(name)} className="rounded-full bg-neutral-100 px-2.5 py-1 font-mono text-xs text-neutral-700 hover:bg-neutral-200">{`{${name}}`}</button>)}</div></div>
						</div>}
					</div>
				</div>
			</DialogFrame>
		</div>,
		document.body,
	);
}
