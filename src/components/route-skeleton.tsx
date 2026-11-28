"use client";

import { usePathname } from "next/navigation";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

function HeaderBar({ tabs = 0 }: { tabs?: number }) {
	return (
		<div className="flex h-16 items-center gap-3 px-4">
			<Skeleton className="h-10 w-10 shrink-0 rounded-full" />
			<Skeleton className="hidden h-6 w-28 md:block" />
			{tabs > 0 && <Skeleton className="ml-3 hidden h-10 rounded-full md:block" style={{ width: `${tabs * 5}rem` }} />}
			<div className="flex-1" />
			<Skeleton className="h-9 w-9 rounded-full" />
		</div>
	);
}

/** Calendar: left upcoming panel and a week grid under the toolbar. */
/** Scheduling section: left menu, then one panel with its title row and a list of cards. */
function CalendarSkeleton() {
	return (
		<div className="safe-area flex h-dvh bg-[#f6f8fc]">
			<div className="hidden w-65 shrink-0 space-y-2 p-3 md:block">
				<Skeleton className="mb-6 h-10 w-36 rounded-xl" />
				{Array.from({ length: 4 }, (_, row) => <Skeleton key={row} className="h-10 w-full rounded-xl" />)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white md:rounded-2xl">
					<div className="flex h-16 items-center gap-3 border-b border-neutral-200 px-5">
						<Skeleton className="h-6 w-40" />
						<div className="flex-1" />
						<Skeleton className="h-10 w-40 rounded-lg" />
					</div>
					<div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4 md:px-8">
						{Array.from({ length: 3 }, (_, row) => <Skeleton key={row} className="h-24 w-full rounded-2xl" />)}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Mail folders and message pages: folder rail plus a list of rows. */
function MailSkeleton() {
	return (
		<div className="safe-area flex h-dvh flex-col bg-[#f6f8fc]">
			<HeaderBar />
			<div className="flex min-h-0 flex-1 gap-3 pl-3 max-md:pl-0">
				<div className="hidden w-60 shrink-0 space-y-2 md:block">
					<Skeleton className="mb-4 h-12 w-36 rounded-2xl" />
					{Array.from({ length: 7 }, (_, row) => <Skeleton key={row} className="h-9 w-full rounded-full" />)}
				</div>
				<div className="min-w-0 flex-1 overflow-hidden rounded-t-3xl bg-white"><SkeletonRows count={10} /></div>
			</div>
		</div>
	);
}

function GenericSkeleton() {
	return (
		<div className="safe-area flex h-dvh flex-col bg-[#f6f8fc]">
			<HeaderBar />
			<div className="min-h-0 flex-1 overflow-hidden px-4">
				<Skeleton className="mb-4 h-8 w-56" />
				<div className="overflow-hidden rounded-2xl bg-white"><SkeletonRows count={8} /></div>
			</div>
		</div>
	);
}

const MAIL_PREFIXES = ["/inbox", "/promotions", "/sent", "/drafts", "/starred", "/snoozed", "/scheduled", "/archived", "/spam", "/trash", "/folders", "/contacts"];

/** Placeholder shown while auth resolves, shaped like the page being opened so the layout does not jump. */
export function RouteSkeleton() {
	const pathname = usePathname() ?? "";
	if (["/calendar", "/booking"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return <CalendarSkeleton />;
	if (MAIL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return <MailSkeleton />;
	return <GenericSkeleton />;
}
