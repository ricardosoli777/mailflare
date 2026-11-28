import { parseBookingTimeRanges, parseBookingWeekdays, timeToMinutes } from "../../../lib/booking/utils";
import { dateFromZonedFields, zonedDateFields } from "../../../lib/time/utils";
import type { MinuteRange, OpenHoursSource } from "./open-hours-types";

const DAY_MS = 86_400_000;

function merge(ranges: MinuteRange[]): MinuteRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const merged: MinuteRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

/**
 * Open booking windows of one grid day, in minutes of the viewer's wall clock.
 * Each booking type keeps its hours in its own time zone, so a window can spill into the neighbouring day.
 */
export function openRangesForDay(types: OpenHoursSource[], dayStart: Date, dayEnd: Date, viewerZone: string): MinuteRange[] {
	const ranges: MinuteRange[] = [];
	const wallMinutes = (value: Date) => {
		if (value <= dayStart) return 0;
		if (value >= dayEnd) return 24 * 60;
		const fields = zonedDateFields(value, viewerZone);
		return fields.getUTCHours() * 60 + fields.getUTCMinutes();
	};
	for (const type of types) {
		if (!type.enabled) continue;
		const weekdays = parseBookingWeekdays(type.weekdays);
		const windows = parseBookingTimeRanges(type.timeRanges, { startTime: type.startTime, endTime: type.endTime });
		const base = zonedDateFields(dayStart, type.timeZone);
		base.setUTCHours(0, 0, 0, 0);
		for (const offset of [-1, 0, 1]) {
			const local = new Date(base.getTime() + offset * DAY_MS);
			if (!weekdays.includes(local.getUTCDay())) continue;
			for (const window of windows) {
				const at = (time: string) => dateFromZonedFields(new Date(local.getTime() + timeToMinutes(time) * 60_000), type.timeZone);
				const start = at(window.startTime);
				const end = at(window.endTime);
				if (end <= dayStart || start >= dayEnd) continue;
				ranges.push({ start: wallMinutes(start), end: wallMinutes(end) });
			}
		}
	}
	return merge(ranges.filter((range) => range.end > range.start));
}

/** Minutes of the open windows not yet past and not covered by a busy interval (both in the same wall-clock minutes). */
export function freeMinutes(open: MinuteRange[], busy: MinuteRange[], from = 0): number {
	const taken = merge(busy);
	let total = 0;
	for (const range of open) {
		const start = Math.max(range.start, from);
		if (range.end <= start) continue;
		total += range.end - start;
		for (const block of taken) total -= Math.max(0, Math.min(range.end, block.end) - Math.max(start, block.start));
	}
	return total;
}

/** Hours the grid shows: the given windows with `padding` hours around them, or the whole day when there are none. */
export function visibleHours(windows: MinuteRange[], padding: number): { start: number; end: number } {
	if (!windows.length) return { start: 0, end: 24 };
	const first = Math.min(...windows.map((range) => range.start));
	const last = Math.max(...windows.map((range) => range.end));
	return { start: Math.max(0, Math.floor(first / 60) - padding), end: Math.min(24, Math.ceil(last / 60) + padding) };
}

export function formatMinutes(total: number): string {
	const hours = Math.floor(total / 60);
	const minutes = Math.round(total % 60);
	if (!hours) return `${minutes}min`;
	return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}
