import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline, Readable } from "node:stream";

type FetchHandler = (request: Request, env: CloudflareEnv) => Promise<Response | null>;

/** The public origin: `APP_URL` when set, else the scheme a trusted proxy reported and the Host header. */
function requestOrigin(request: IncomingMessage, env: Pick<CloudflareEnv, "APP_URL">): string {
	try {
		if (env.APP_URL?.trim()) return new URL(env.APP_URL.trim()).origin;
	} catch {
		// Fall through to the Host header.
	}
	const trustProxy = ["1", "true", "yes"].includes((process.env.TRUST_PROXY ?? "").toLowerCase());
	const forwarded = request.headers["x-forwarded-proto"];
	const hop = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded)?.split(",").at(-1)?.trim().toLowerCase();
	const protocol = trustProxy && (hop === "https" || hop === "http") ? hop : "http";
	return `${protocol}://${request.headers.host || "localhost"}`;
}

/**
 * The request body as a stream that touches the socket only when the handler
 * reads it. Wrapping the request up front would start consuming it, and an
 * early answer (401, 404, 405) would leave it half read and the connection stuck.
 */
function lazyBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
	let source: ReadableStreamDefaultReader<Uint8Array> | undefined;
	return new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				source ??= (Readable.toWeb(incoming) as ReadableStream<Uint8Array>).getReader();
				const { done, value } = await source.read();
				if (done) controller.close();
				else controller.enqueue(value);
			},
			cancel: (reason) => source?.cancel(reason),
		},
		{ highWaterMark: 0 },
	);
}

const DISCARD_BYTES = 8 * 1024 * 1024;
const DISCARD_MS = 2000;

/**
 * Throw away what is left of a body nobody read, within a size and time limit.
 * Closing a socket that still holds unread bytes resets it (always on Windows),
 * and the client would get a connection error instead of the answer.
 */
function discardRest(incoming: IncomingMessage): Promise<void> {
	return new Promise((resolve) => {
		let bytes = 0;
		const done = () => {
			clearTimeout(timer);
			incoming.off("data", count).off("end", done).off("error", done).off("close", done);
			resolve();
		};
		const count = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes <= DISCARD_BYTES) return;
			incoming.pause();
			done();
		};
		const timer = setTimeout(done, DISCARD_MS);
		incoming.on("data", count).on("end", done).on("error", done).on("close", done);
		incoming.resume();
	});
}

/**
 * Run a framework-free fetch handler (like `handleDavRequest`) behind the Node
 * server. The URL is origin + the raw request target as a string, so a target
 * such as `//host/path` cannot swap the host. The handler gets every header
 * (including the ones the server stamped), the body streams in, and the
 * response streams out. A handler that returns null answers 404; one that
 * throws answers a bare 500 and logs the error.
 */
export async function serveFetch(handler: FetchHandler, incoming: IncomingMessage, outgoing: ServerResponse, env: CloudflareEnv): Promise<void> {
	try {
		const target = incoming.url ?? "/";
		if (!target.startsWith("/")) {
			outgoing.writeHead(400).end();
			return;
		}
		const headers = new Headers();
		for (const [name, value] of Object.entries(incoming.headers)) {
			if (Array.isArray(value)) for (const item of value) headers.append(name, item);
			else if (value !== undefined) headers.set(name, value);
		}
		const method = incoming.method ?? "GET";
		const hasBody = method !== "GET" && method !== "HEAD";
		const request = new Request(`${requestOrigin(incoming, env)}${target}`, {
			method,
			headers,
			...(hasBody ? { body: lazyBody(incoming), duplex: "half" } : {}),
		} as RequestInit);
		const response = (await handler(request, env)) ?? new Response("Not found", { status: 404 });
		const outHeaders: Record<string, string | string[]> = {};
		response.headers.forEach((value, name) => {
			if (name !== "set-cookie") outHeaders[name] = value;
		});
		const cookies = response.headers.getSetCookie();
		if (cookies.length) outHeaders["set-cookie"] = cookies;
		// Request bytes still on the wire cannot be skipped on a kept-alive connection: close it once the answer is out.
		if (!incoming.complete) {
			outHeaders.connection = "close";
			// A body the handler started reading belongs to its stream; leave it alone.
			if (!incoming.readableDidRead) await discardRest(incoming);
		}
		outgoing.writeHead(response.status, outHeaders);
		if (!response.body || method === "HEAD") {
			outgoing.end();
			return;
		}
		pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), outgoing, (error) => {
			if (error) console.error("Response stream failed", error);
		});
	} catch (error) {
		console.error("Request failed", error);
		if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		outgoing.end(outgoing.headersSent ? undefined : "Internal error");
	}
}
