"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import toast from "react-hot-toast";
import { CalendarDays, Copy, ExternalLink, Globe2, Link2, Settings } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { SidebarHeader } from "@/components/sidebar-header";
import { useSidebar } from "@/components/sidebar-state";
import { authFetch } from "@/lib/auth/client";
import type { CalendarMenuItemProps } from "./calendar-menu-types";

const itemClass = "relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors";
const idleClass = "text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900";

function MenuItem({ href, label, icon: Icon, minimal }: CalendarMenuItemProps) {
	const pathname = usePathname();
	const active = pathname === href;
	return (
		<Link href={href} aria-current={active ? "page" : undefined} aria-label={minimal ? label : undefined} title={minimal ? label : undefined}
			className={clsx(itemClass, minimal && "justify-center px-0", active ? "bg-white text-neutral-900 shadow-sm" : idleClass)}>
			{active && <span aria-hidden="true" className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-blue-600" />}
			<Icon className="h-[18px] w-[18px] shrink-0" />
			{!minimal && <span className="truncate">{label}</span>}
		</Link>
	);
}

/** Left menu of the scheduling section, on the desktop column and inside the phone drawer. */
export function CalendarMenu() {
	const { t } = useLanguage();
	const { minimal } = useSidebar();
	const [username, setUsername] = useState("");

	useEffect(() => {
		let active = true;
		// Only the public address is needed here; without it the booking page entry stays hidden.
		void authFetch("/api/booking")
			.then(async (response) => response.ok ? ((await response.json()) as { username?: string | null }).username ?? "" : "")
			.then((value) => { if (active) setUsername(value); })
			.catch(() => undefined);
		return () => { active = false; };
	}, []);

	async function copyPageLink() {
		try { await navigator.clipboard.writeText(`${window.location.origin}/c/${username}`); toast.success(t("booking.linkCopied")); }
		catch { toast.error(t("booking.copyFailed")); }
	}

	const heading = (label: string) => minimal
		? <div aria-hidden="true" className="mx-2 my-3 border-t border-neutral-200" />
		: <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>;

	return (
		<div className="flex h-full min-h-0 flex-col px-3 pb-3 pt-3">
			<SidebarHeader href="/inbox" />
			<nav aria-label={t("calendar.sections")} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
				{heading(t("calendar.menu.scheduling"))}
				<MenuItem href="/booking" label={t("calendar.menu.bookingTypes")} icon={Link2} minimal={minimal} />
				<MenuItem href="/calendar" label={t("calendar.calendar")} icon={CalendarDays} minimal={minimal} />
				{username && <>
					{heading(t("calendar.menu.tools"))}
					<div className="flex items-center gap-1">
						<a href={`/c/${username}`} target="_blank" rel="noopener noreferrer" aria-label={minimal ? t("calendar.menu.bookingPage") : undefined} title={minimal ? t("calendar.menu.bookingPage") : undefined}
							className={clsx(itemClass, "min-w-0 flex-1", minimal && "justify-center px-0", idleClass)}>
							<Globe2 className="h-[18px] w-[18px] shrink-0" />
							{!minimal && <span className="truncate">{t("calendar.menu.bookingPage")}</span>}
						</a>
						{!minimal && <>
							<button type="button" onClick={() => void copyPageLink()} aria-label={t("booking.copyLink")} title={t("booking.copyLink")} className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", idleClass)}><Copy className="h-4 w-4" /></button>
							<a href={`/c/${username}`} target="_blank" rel="noopener noreferrer" aria-label={t("booking.openPage", { name: username })} className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", idleClass)}><ExternalLink className="h-4 w-4" /></a>
						</>}
					</div>
				</>}
			</nav>
			<div className="shrink-0 border-t border-neutral-200 pt-2">
				<MenuItem href="/settings" label={t("account.settings")} icon={Settings} minimal={minimal} />
			</div>
		</div>
	);
}
