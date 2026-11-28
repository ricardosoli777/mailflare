import type { CalendarEvent } from "./types";

export type CalendarListProps = {
	events: CalendarEvent[];
	from: Date;
	onEdit: (event: CalendarEvent) => void;
};
