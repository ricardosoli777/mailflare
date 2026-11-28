"use client";

import clsx from "clsx";
import { Clock3, ExternalLink, Link2, MapPin, MoreVertical, Share2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import type { BookingTypeCardProps } from "./booking-type-card-types";
import { availabilityLabel, durationLabel } from "./utils";

const actionClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900";
const chipClass = "inline-flex max-w-full items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600";
const menuItemClass = "block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100";

export function BookingTypeCard({ event, username, busy, menuOpen, onMenu, onEdit, onEnabled, onCopy, onShare, onDuplicate, onDelete }: BookingTypeCardProps) {
	const { t } = useLanguage();
	const linkable = event.enabled && Boolean(username);
	return (
		<article className="relative flex flex-wrap items-start gap-x-4 gap-y-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 transition-colors hover:border-neutral-300">
			<div className={clsx("min-w-0 flex-1 basis-64", !event.enabled && "opacity-60")}>
				<h2 className="flex items-center gap-3 text-base font-semibold text-neutral-900">
					<span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: normalizeCalendarColor(event.color) }} />
					<button type="button" onClick={onEdit} className="min-w-0 truncate text-left hover:text-blue-700">{event.name}</button>
				</h2>
				<p className="mt-3 flex flex-wrap gap-2">
					<span className={chipClass}><Clock3 className="h-3.5 w-3.5 shrink-0" />{durationLabel(event.durationMinutes, t)}</span>
					{event.location && <span className={chipClass}><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{event.location}</span></span>}
					<span className={chipClass}><span className="truncate">{availabilityLabel(event, t)}</span></span>
				</p>
			</div>
			<div className="ml-auto flex items-center gap-1">
				<label className="mr-2 flex items-center gap-2 text-sm text-neutral-600">
					{t("booking.types.enabled")}
					<Switch checked={event.enabled} disabled={busy} onCheckedChange={onEnabled} aria-label={event.enabled ? t("booking.turnOff") : t("booking.turnOn")} />
				</label>
				{linkable && <>
					<button type="button" onClick={onCopy} aria-label={t("booking.copyLink")} title={t("booking.copyLink")} className={actionClass}><Link2 className="h-4 w-4" /></button>
					<a href={`/c/${username}/${event.slug}`} target="_blank" rel="noopener noreferrer" aria-label={t("booking.openPage", { name: event.name })} title={t("booking.openPage", { name: event.name })} className={actionClass}><ExternalLink className="h-4 w-4" /></a>
					<button type="button" onClick={onShare} aria-label={t("booking.types.share")} title={t("booking.types.share")} className={actionClass}><Share2 className="h-4 w-4" /></button>
				</>}
				{!event.isTemplate && <div className="relative" onBlur={(blur) => { if (!blur.currentTarget.contains(blur.relatedTarget)) onMenu(false); }} onKeyDown={(key) => { if (key.key === "Escape") onMenu(false); }}>
					<button type="button" aria-label={t("booking.moreOptions", { name: event.name })} aria-expanded={menuOpen} onClick={() => onMenu(!menuOpen)} className={actionClass}><MoreVertical className="h-4 w-4" /></button>
					{menuOpen && <div className="absolute right-0 top-10 z-10 w-40 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
						<button type="button" onClick={onEdit} className={menuItemClass}>{t("booking.edit")}</button>
						<button type="button" onClick={onDuplicate} className={menuItemClass}>{t("booking.types.duplicate")}</button>
						<button type="button" onClick={onDelete} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">{t("common.delete")}</button>
					</div>}
				</div>}
			</div>
		</article>
	);
}
