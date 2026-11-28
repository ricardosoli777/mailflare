"use client";

import { SkipToContent } from "@/components/skip-to-content";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AssistantOpenContext } from "@/components/agent/assistant-open-state";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { LicenseIndicator } from "@/components/license-indicator";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { SidebarAside, MobileMenuButton } from "@/components/sidebar-aside";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { CalendarMenu } from "./calendar-menu";
import { useDashboardState } from "../(dashboard)/dashboard-state";
import { useAssistantAvailability } from "../(dashboard)/use-assistant-availability";
import { RouteTitle } from "@/components/route-title";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const { assistantOpen, setAssistantOpen, assistantFullSize, setAssistantFullSize } = useDashboardState();
  const assistantEnabled = useAssistantAvailability();
  const assistantVisible = assistantEnabled === true && assistantOpen;

  useEffect(() => {
    if (assistantEnabled === false && (assistantOpen || assistantFullSize)) {
      setAssistantOpen(false);
      setAssistantFullSize(false);
    }
  }, [assistantEnabled, assistantOpen, assistantFullSize, setAssistantOpen, setAssistantFullSize]);

  return (
    <AuthGuard requireFeature="calendar">
      <SidebarProvider mobileOverlay>
        <MailboxProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
                <RouteTitle />
              <div className="safe-area flex h-dvh overflow-hidden bg-[#f6f8fc]">
                <SkipToContent />
                <SidebarAside className="shrink-0"><CalendarMenu /></SidebarAside>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col md:py-2 md:pr-2">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white md:rounded-2xl">
                  <header className="flex min-h-16 w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 py-2 pl-5 pr-3 text-sm max-md:gap-x-1 max-md:pl-2 max-md:pr-2">
                    <MobileMenuButton />
                    <h1 className="min-w-0 truncate text-lg font-semibold text-neutral-900 max-md:flex-1 max-md:basis-0 max-md:text-base">{pathname === "/calendar" ? t("calendar.calendar") : t("calendar.menu.bookingTypes")}</h1>
                    <div id="calendar-header-slot" className="flex min-w-0 flex-1 items-center justify-end gap-2 max-md:order-last max-md:basis-full max-md:empty:hidden" />
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <LicenseIndicator />
                      {assistantEnabled && <Button type="button" variant="ghost" size="sm" className={assistantOpen ? "bg-blue-50 text-blue-700" : "text-neutral-600"} onClick={() => { setAssistantOpen((current) => !current); setAssistantFullSize(false); }} aria-label={assistantOpen ? t("agent.assistant.close") : t("agent.assistant.open")} aria-expanded={assistantOpen} aria-controls="email-assistant-panel"><Sparkles className="h-5 w-5" /></Button>}
                      <MailboxSelector />
                    </div>
                  </header>
                  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <AssistantOpenContext.Provider value={assistantVisible}>
                      <main id="main-content" tabIndex={-1} className="focus:outline-none min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain scrollbar-gutter-stable" aria-hidden={assistantVisible && assistantFullSize} inert={assistantVisible && assistantFullSize}>
                        <div key={pathname} className="page-transition-enter h-full min-h-0">{children}</div>
                      </main>
                    </AssistantOpenContext.Provider>
                    <aside className={clsx(assistantFullSize ? "pl-0" : "pl-4", "min-h-0 min-w-0 shrink-0 overflow-hidden pb-2 pr-2 max-md:p-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none", assistantVisible ? "" : "opacity-0")} style={{ width: assistantVisible ? assistantFullSize ? "100%" : "min(390px, 100%)" : "0px" }} aria-hidden={!assistantVisible} inert={!assistantVisible}>
                      {assistantEnabled && <AgentPanel open={assistantVisible} fullSize={assistantFullSize} onToggleFullSize={() => setAssistantFullSize((current) => !current)} onClose={() => { setAssistantOpen(false); setAssistantFullSize(false); }} />}
                    </aside>
                  </div>
                </div>
                </div>
                <FloatingComposer />
              </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
