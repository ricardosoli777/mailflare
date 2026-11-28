import { NextResponse } from "next/server";
import { availableBookingSlots } from "@/lib/booking/availability";
import { getEnv } from "@/lib/cloudflare";
import { createBookedCalendarEvents } from "@/lib/booking/create";
import { sendBookingConfirmation } from "@/lib/booking/confirmation";
import { allowBookingAttempt } from "@/lib/auth/rate-limit";
import { calendarText } from "@/lib/calendar/mail-text-utils";
import { resolveLocale } from "@/lib/i18n/utils";
import type { PublicBookingRouteContext, PublicBookingSubmission } from "./types";
import { loadPublicBookingEvent, parseBookingGuestEmails } from "./utils";

/** The language the booking page is shown in: the visitor's choice, else the app default. */
const pageLocale = (request: Request) => resolveLocale(/(?:^|;\s*)mailflare-locale=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1]);

export async function GET(request: Request, { params }: PublicBookingRouteContext) {
	const { eventId } = await params;
	const found = await loadPublicBookingEvent(eventId, new URL(request.url).searchParams.get("username"));
	if (!found) return NextResponse.json({ error: calendarText(pageLocale(request)).eventNotFound }, { status: 404 });
	const slots = await availableBookingSlots(getEnv(), found.event, 60);
	return NextResponse.json({ event: found.event, hostName: found.hostName, slots });
}

export async function POST(request: Request, { params }: PublicBookingRouteContext) {
	const locale = pageLocale(request);
	const text = calendarText(locale);
	if (!(await allowBookingAttempt(getEnv(), request))) return NextResponse.json({ error: text.tooManyAttempts }, { status: 429 });
	const { eventId } = await params;
	const found = await loadPublicBookingEvent(eventId, new URL(request.url).searchParams.get("username"));
	if (!found) return NextResponse.json({ error: text.eventNotFound }, { status: 404 });
	const body = await request.json().catch(() => null) as PublicBookingSubmission | null;
	const name = typeof body?.name === "string" ? body.name.trim() : "";
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || typeof body?.startsAt !== "string") return NextResponse.json({ error: text.missingDetails }, { status: 400 });
	const guestEmails = parseBookingGuestEmails(body?.guestEmails, email);
	const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
	if (!guestEmails || notes.length > 2000 || (body?.notes !== undefined && typeof body.notes !== "string")) return NextResponse.json({ error: text.invalidDetails }, { status: 400 });
	const slots = await availableBookingSlots(getEnv(), found.event, 60);
	const slot = slots.find((item) => item.startsAt === body.startsAt);
	if (!slot) return NextResponse.json({ error: text.slotTaken }, { status: 409 });
	if (!(await createBookedCalendarEvents(getEnv(), found.event, name, email, slot.startsAt, slot.endsAt, guestEmails, notes))) return NextResponse.json({ error: text.slotTaken }, { status: 409 });
	await sendBookingConfirmation(getEnv(), { event: found.event, hostName: found.hostName, guestName: name, guestEmail: email, notes, startsAt: slot.startsAt, endsAt: slot.endsAt, locale, publicOrigin: new URL(request.url).origin });
	return NextResponse.json({ booked: true, startsAt: slot.startsAt, endsAt: slot.endsAt });
}
