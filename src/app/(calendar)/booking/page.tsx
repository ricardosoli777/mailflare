"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import clsx from "clsx";
import { CalendarDays, Plus, Search } from "@/components/icons";
import toast, { Toaster } from "react-hot-toast";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { RouteLoadingBarPortal } from "@/components/route-loading-bar-portal";
import { authFetch } from "@/lib/auth/client";
import { getUserTimeZone } from "@/lib/time/utils";
import { BookingEditor } from "./booking-editor";
import { BookingListSkeleton } from "./booking-list-skeleton";
import { BookingTypeCard } from "./booking-type-card";
import type { BookingTypeFilter } from "./booking-type-card-types";
import { visibleBookingEvents } from "./default-events";
import type { BookingEvent, BookingForm, BookingHost } from "./types";
import { emptyBookingForm, formFromEvent } from "./utils";

const FILTERS: BookingTypeFilter[] = ["all", "active", "inactive"];
// The header slot is a node in the layout; it never changes once mounted, so there is nothing to subscribe to.
const subscribeToHeaderSlot = () => () => {};
const getHeaderSlot = () => document.getElementById("calendar-header-slot");
const getServerHeaderSlot = () => null;

export default function BookingsPage() {
	const { t, locale } = useLanguage();
	const headerTarget = useSyncExternalStore(subscribeToHeaderSlot, getHeaderSlot, getServerHeaderSlot);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [filter, setFilter] = useState<BookingTypeFilter>("all");
	const [events, setEvents] = useState<BookingEvent[]>([]);
	const [username, setUsername] = useState("");
	const [hosts, setHosts] = useState<BookingHost[]>([]);
	const [canManageHosts, setCanManageHosts] = useState(false);
	const [currentUserId, setCurrentUserId] = useState("");
	const [loading, setLoading] = useState(true);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<BookingForm | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [menuId, setMenuId] = useState<string | null>(null);
	const [savingId, setSavingId] = useState<string | null>(null);
	const listEvents = visibleBookingEvents(events, currentUserId, getUserTimeZone(), locale);
	const query = search.trim().toLocaleLowerCase(locale);
	const shownEvents = listEvents.filter((event) => (filter === "all" || event.enabled === (filter === "active")) && (!query || event.name.toLocaleLowerCase(locale).includes(query)));

	useEffect(() => {
		let active = true;
		void authFetch("/api/booking").then(async (response) => {
			if (!response.ok) throw new Error();
			return response.json() as Promise<{ events: BookingEvent[]; username: string | null; currentUser: BookingHost; canManageHosts: boolean; hosts: BookingHost[] }>;
		}).then((data) => {
			if (!active) return;
			setEvents(data.events); setUsername(data.username ?? ""); setCurrentUserId(data.currentUser.id);
			setHosts([data.currentUser, ...data.hosts]); setCanManageHosts(data.canManageHosts);
		})
			.catch(() => { if (active) toast.error(t("booking.loadFailed")); })
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [t]);

	useEffect(() => {
		if (panelOpen || !form) return;
		const timeout = window.setTimeout(() => { setForm(null); setEditingId(null); }, 320);
		return () => window.clearTimeout(timeout);
	}, [panelOpen, form]);

	function revealPanel() { setPanelOpen(false); requestAnimationFrame(() => requestAnimationFrame(() => setPanelOpen(true))); }
	function startCreate() { if (!currentUserId) return; setEditingId(null); setForm(emptyBookingForm(getUserTimeZone(), currentUserId)); setMenuId(null); revealPanel(); }
	function startEdit(event: BookingEvent) { setEditingId(event.isTemplate ? null : event.id); setForm({ ...formFromEvent(event), enabled: event.isTemplate ? true : event.enabled }); setMenuId(null); if (!panelOpen) revealPanel(); }
	function closeEditor() { setPanelOpen(false); }

	async function save() {
		if (!form) return;
		setSaving(true);
		try {
			const response = await authFetch(editingId ? `/api/booking/${editingId}` : "/api/booking", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
			const data = await response.json() as { event?: BookingEvent; error?: string };
			if (!response.ok || !data.event) { toast.error(data.error ?? t("booking.saveFailed")); return; }
			setEvents((current) => editingId ? current.map((item) => item.id === editingId ? data.event! : item) : [...current, data.event!]);
			closeEditor();
			toast.success(editingId ? t("booking.saved") : t("booking.created"));
		} catch { toast.error(t("booking.saveFailed")); }
		finally { setSaving(false); }
	}

	async function setEnabled(event: BookingEvent, enabled: boolean) {
		if (event.isTemplate && !enabled) return;
		setSavingId(event.id);
		try {
			const response = await authFetch(event.isTemplate ? "/api/booking" : `/api/booking/${event.id}`, { method: event.isTemplate ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...formFromEvent(event), enabled }) });
			const data = await response.json() as { event?: BookingEvent; error?: string };
			if (!response.ok || !data.event) throw new Error(data.error);
			setEvents((current) => event.isTemplate ? [...current, data.event!] : current.map((item) => item.id === event.id ? data.event! : item));
			if (editingId === event.id && form) setForm({ ...form, enabled });
			setMenuId(null);
		} catch { toast.error(event.isTemplate ? t("booking.enableFailed") : t("booking.updateFailed")); }
		finally { setSavingId(null); }
	}

	async function duplicate(event: BookingEvent) {
		setMenuId(null);
		const taken = new Set(events.map((item) => item.slug));
		let slug = `${event.slug}-2`;
		for (let number = 3; taken.has(slug); number++) slug = `${event.slug}-${number}`;
		try {
			// A copy starts switched off, so it is not published before it is reviewed.
			const response = await authFetch("/api/booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...formFromEvent(event), name: t("booking.types.copyName", { name: event.name }), slug, enabled: false }) });
			const data = await response.json() as { event?: BookingEvent; error?: string };
			if (!response.ok || !data.event) { toast.error(data.error ?? t("booking.saveFailed")); return; }
			setEvents((current) => [...current, data.event!]);
			toast.success(t("booking.created"));
		} catch { toast.error(t("booking.saveFailed")); }
	}

	async function remove(event: BookingEvent) {
		if (!await confirmDestructive(t("booking.deleteConfirm", { name: event.name }))) return;
		try {
			const response = await authFetch(`/api/booking/${event.id}`, { method: "DELETE" });
			if (!response.ok) throw new Error();
			setEvents((current) => current.filter((item) => item.id !== event.id));
			if (editingId === event.id) closeEditor();
			setMenuId(null);
		} catch { toast.error(t("booking.deleteFailed")); }
	}

	async function copyLink(event: BookingEvent) {
		if (!username) { toast.error(t("booking.usernameUnavailable")); return; }
		try { await navigator.clipboard.writeText(`${window.location.origin}/c/${username}/${event.slug}`); toast.success(t("booking.linkCopied")); }
		catch { toast.error(t("booking.copyFailed")); }
	}

	async function share(event: BookingEvent) {
		if (!navigator.share) return copyLink(event);
		// Closing the share sheet rejects too, which is not an error.
		await navigator.share({ title: event.name, url: `${window.location.origin}/c/${username}/${event.slug}` }).catch(() => undefined);
	}

	return <div className="flex h-full min-h-0 min-w-0">
		<Toaster position="bottom-left" />
		{loading && <RouteLoadingBarPortal />}
		{headerTarget && createPortal(<>
			{searchOpen && <input autoFocus type="search" value={search} onChange={(change) => setSearch(change.target.value)} onKeyDown={(key) => { if (key.key === "Escape") { setSearch(""); setSearchOpen(false); } }}
				placeholder={t("booking.types.search")} aria-label={t("booking.types.search")} className="h-10 min-w-0 max-w-64 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-blue-600" />}
			<button type="button" onClick={() => { setSearch(""); setSearchOpen((open) => !open); }} aria-label={t("booking.types.search")} aria-expanded={searchOpen} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"><Search className="h-5 w-5" /></button>
			<Button type="button" onClick={startCreate} disabled={!currentUserId} className="h-10 shrink-0 rounded-lg bg-blue-600 px-4 text-white hover:bg-blue-500"><Plus size={18} />{t("booking.types.new")}</Button>
		</>, headerTarget)}
		<div className="min-w-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable">
			<div className="mx-auto max-w-5xl px-4 pb-10 pt-4 md:px-8">
				<div className="flex justify-end border-b border-neutral-200 pb-4">
					<div role="group" aria-label={t("calendar.menu.bookingTypes")} className="flex rounded-xl bg-neutral-100 p-1">
						{FILTERS.map((option) => <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)} className={clsx("rounded-lg px-4 py-1.5 text-sm font-medium", filter === option ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900")}>{t(`booking.types.${option}`)}</button>)}
					</div>
				</div>
				<section aria-label={t("booking.events")} className="space-y-3 pt-4">
					{loading ? <BookingListSkeleton /> : shownEvents.length === 0 ? <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center"><CalendarDays className="mx-auto mb-3 h-8 w-8 text-neutral-400" /><h2 className="font-medium text-neutral-900">{listEvents.length ? t("booking.types.noMatch") : t("booking.none")}</h2>{!listEvents.length && <p className="mt-1 text-sm text-neutral-500">{t("booking.noneHint")}</p>}</div>
						: shownEvents.map((event) => <BookingTypeCard key={event.id} event={event} username={username} busy={savingId !== null} menuOpen={menuId === event.id}
							onMenu={(open) => setMenuId(open ? event.id : null)} onEdit={() => startEdit(event)} onEnabled={(enabled) => void setEnabled(event, enabled)}
							onCopy={() => void copyLink(event)} onShare={() => void share(event)} onDuplicate={() => void duplicate(event)} onDelete={() => void remove(event)} />)}
				</section>
			</div>
		</div>
				{form && <BookingEditor form={form} open={panelOpen} editingId={editingId} username={username} hosts={hosts} canManageHosts={canManageHosts} currentUserId={currentUserId} saving={saving} onChange={setForm} onClose={closeEditor} onSave={() => void save()} onDelete={() => { const event = events.find((item) => item.id === editingId); if (event) void remove(event); }} onToggleEnabled={() => { const event = events.find((item) => item.id === editingId); if (event) void setEnabled(event, !event.enabled); }} onClosed={() => { if (!panelOpen) { setForm(null); setEditingId(null); } }} />}
	</div>;
}
