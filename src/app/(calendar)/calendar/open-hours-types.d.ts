export type MinuteRange = { start: number; end: number };

/** The fields of a booking type that say when it can be booked. */
export type OpenHoursSource = {
	enabled: boolean;
	weekdays: string;
	startTime: string;
	endTime: string;
	timeRanges: string;
	timeZone: string;
};
