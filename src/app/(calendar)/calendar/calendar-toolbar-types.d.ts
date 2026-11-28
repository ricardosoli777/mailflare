import type { ReactNode } from "react";
import type { CalendarView } from "./types";

export type CalendarRangeMode = "open" | "business" | "full";

export type CalendarToolbarProps = {
	view: CalendarView;
	onView: (view: CalendarView) => void;
	title: ReactNode;
	onPrevious: () => void;
	onNext: () => void;
	onToday: () => void;
	eventCount: number;
	freeTime: string;
	hasOpenHours: boolean;
	showEvents: boolean;
	showOpenHours: boolean;
	onToggleEvents: () => void;
	onToggleOpenHours: () => void;
	range: CalendarRangeMode;
	onRange: (range: CalendarRangeMode) => void;
};
