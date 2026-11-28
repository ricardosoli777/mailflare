import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "MailLead",
		short_name: "MailLead",
		description: "Email, anywhere.",
		id: "/",
		scope: "/",
		start_url: "/inbox",
		display: "standalone",
		background_color: "#ffffff",
		theme_color: "#e7eaf1",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
			{ src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
