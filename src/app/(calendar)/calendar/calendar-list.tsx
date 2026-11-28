"use client";

import { useMemo } from "react";
import { CalendarDays } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import type { CalendarListProps } from "./calendar-list-types";
import { formatEventRange, groupUpcomingEvents } from "./utils";

/** List view: events from the chosen day on, grouped by day. */
export function CalendarList({ events, from, onEdit }: CalendarListProps) {
	const { t } = useLanguage();
	const groups = useMemo(() => groupUpcomingEvents(events, from, t), [events, from, t]);
	if (!groups.length) return (
		<div className="mx-4 my-2 rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center md:mx-6">
			<CalendarDays className="mx-auto mb-3 h-8 w-8 text-neutral-400" />
			<p className="text-sm text-neutral-500">{t("calendar.noUpcoming")}</p>
		</div>
	);
	return (
		<div className="space-y-5 px-4 pb-8 md:px-6">
			{groups.map((group) => (
				<section key={group.key}>
					<h2 className="mb-2 text-sm font-semibold text-neutral-900">{group.label}</h2>
					<div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
						{group.events.map((event) => (
							<button key={event.id} type="button" onClick={() => onEdit(event)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50">
								<span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: normalizeCalendarColor(event.color) }} />
								<span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{event.title}</span>
								<span className="shrink-0 text-sm text-neutral-500">{formatEventRange(event)}</span>
							</button>
						))}
					</div>
				</section>
			))}
		</div>
	);
}
