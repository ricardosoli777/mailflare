"use client";

import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Select } from "@/components/ui/select";
import type { CalendarRangeMode, CalendarToolbarProps } from "./calendar-toolbar-types";

const segmentGroup = "flex shrink-0 rounded-xl bg-neutral-100 p-1";
const segment = (active: boolean) => clsx("rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900");
const squareButton = "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200";

export function CalendarToolbar({ view, onView, title, onPrevious, onNext, onToday, eventCount, freeTime, hasOpenHours, showEvents, showOpenHours, onToggleEvents, onToggleOpenHours, range, onRange }: CalendarToolbarProps) {
	const { t } = useLanguage();
	const legend = (active: boolean, label: string, swatch: string, toggle: () => void) => (
		<button type="button" aria-pressed={active} onClick={toggle} className={clsx("flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200", !active && "opacity-50")}>
			<span aria-hidden="true" className={clsx("h-3 w-3 rounded", swatch)} />{label}
		</button>
	);
	return (
		<div className="shrink-0 space-y-3 px-4 py-3 md:px-6">
			<div className="flex flex-wrap items-center gap-3">
				<div role="group" aria-label={t("calendar.view")} className={segmentGroup}>
					<button type="button" aria-pressed={view === "list"} aria-label={t("calendar.listMode")} title={t("calendar.listMode")} onClick={() => onView("list")} className={segment(view === "list")}><List className="h-4 w-4" /></button>
					<button type="button" aria-pressed={view !== "list"} aria-label={t("calendar.gridMode")} title={t("calendar.gridMode")} onClick={() => { if (view === "list") onView("week"); }} className={segment(view !== "list")}><CalendarDays className="h-4 w-4" /></button>
				</div>
				<p className="min-w-0 flex-1 text-sm text-neutral-500">{hasOpenHours ? t("calendar.summary", { events: eventCount, time: freeTime }) : t("calendar.summaryEvents", { events: eventCount })}</p>
				{legend(showEvents, t("calendar.legend.events"), "bg-blue-600", onToggleEvents)}
				{hasOpenHours && legend(showOpenHours, t("calendar.legend.open"), "border border-green-600 bg-green-100", onToggleOpenHours)}
			</div>
			{!hasOpenHours && <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-700">
				{t("calendar.noOpenHours")}
				<Link href="/booking" className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500">{t("calendar.menu.bookingTypes")}</Link>
			</p>}
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" aria-label={t(`calendar.previousView.${view === "list" ? "month" : view}`)} onClick={onPrevious} className={squareButton}><ChevronLeft className="h-5 w-5" /></button>
				<button type="button" aria-label={t(`calendar.nextView.${view === "list" ? "month" : view}`)} onClick={onNext} className={squareButton}><ChevronRight className="h-5 w-5" /></button>
				<button type="button" onClick={onToday} className="h-10 shrink-0 rounded-lg bg-neutral-100 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-200">{t("calendar.today")}</button>
				<div className="min-w-0 flex-1 basis-40 px-2">{title}</div>
				<div role="group" aria-label={t("calendar.view")} className={segmentGroup}>
					{(["day", "week", "month", "list"] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => onView(option)} className={segment(view === option)}>{t(`calendar.${option}`)}</button>)}
				</div>
				{(view === "week" || view === "day") && <>
					<Select aria-label={t("calendar.rangeLabel")} value={range} onChange={(change) => onRange(change.target.value as CalendarRangeMode)} containerClassName="w-auto" className="h-10 w-auto rounded-lg bg-white pl-3 pr-2 text-sm text-neutral-700">
						{hasOpenHours && <option value="open">{t("calendar.range.open")}</option>}
						<option value="business">{t("calendar.range.business")}</option>
						<option value="full">{t("calendar.range.full")}</option>
					</Select>
					<button type="button" onClick={() => onRange(range === "full" ? (hasOpenHours ? "open" : "business") : "full")} className="h-10 shrink-0 rounded-lg bg-neutral-100 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-200">{range === "full" ? t("calendar.range.collapse") : t("calendar.range.showFull")}</button>
				</>}
			</div>
		</div>
	);
}
