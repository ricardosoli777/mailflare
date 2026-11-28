import type { BookingEvent } from "./types";

export type BookingTypeCardProps = {
	event: BookingEvent;
	/** Empty until the account has a public address; the link actions need it. */
	username: string;
	busy: boolean;
	menuOpen: boolean;
	onMenu: (open: boolean) => void;
	onEdit: () => void;
	onEnabled: (enabled: boolean) => void;
	onCopy: () => void;
	onShare: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
};

export type BookingTypeFilter = "all" | "active" | "inactive";
