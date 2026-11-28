import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { LanguageProvider } from "@/components/language-provider";
import { FALLBACK_LOCALE, getDirection } from "@/lib/i18n/utils";
import { getRequestLocale, loadServerMessages } from "@/lib/i18n/server";
import { sidebarBootstrapScript } from "@/components/sidebar-state-utils";
import { themeBootstrapScript } from "@/components/theme-utils";
import { getHomeBranding } from "./home-server-utils";
import "./globals.css";

// Text and headings. vinext downloads them at build time and serves them from the app, as the CSP requires.
const textFont = Inter({
	variable: "--font-app-sans",
	subsets: ["latin", "latin-ext"],
});

const headingFont = Plus_Jakarta_Sans({
	variable: "--font-app-heading",
	subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

// Colours are the --background tokens in globals.css (light #e7eaf1, dark #121316).
// viewportFit "cover" lets the shell reach the notch and home indicator; the env(safe-area-inset-*) padding keeps content clear of them.
export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#e7eaf1" },
		{ media: "(prefers-color-scheme: dark)", color: "#121316" },
	],
	viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
	const { appName } = await getHomeBranding();
	return {
		title: appName,
		description: "Multi-tenant email on Cloudflare",
		// The version query makes browsers drop a favicon cached from before the MailLead rebrand.
		icons: { icon: "/api/branding/icon?v=maillead", apple: "/apple-touch-icon.png?v=maillead" },
		appleWebApp: {
			capable: true,
			title: appName,
			statusBarStyle: "default",
		},
		robots: {
			index: false,
			follow: false,
			noarchive: true,
			nosnippet: true,
			noimageindex: true,
			googleBot: {
				index: false,
				follow: false,
				noarchive: true,
				nosnippet: true,
				noimageindex: true,
			},
		},
	};
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const locale = await getRequestLocale();
	const messages = locale === FALLBACK_LOCALE ? undefined : await loadServerMessages(locale);
	const branding = await getHomeBranding();
	return (
		<html lang={locale} dir={getDirection(locale)} data-remote-image-proxy="enabled" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: sidebarBootstrapScript }} />
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
				<link rel="icon" href="/api/branding/icon?v=maillead"></link>
			</head>
			<body className={`${textFont.variable} ${headingFont.variable} ${geistMono.variable} antialiased`}>
				<LanguageProvider initialLocale={locale} initialMessages={messages}><Providers initialBranding={branding}>{children}</Providers></LanguageProvider>
			</body>
		</html>
	);
}
