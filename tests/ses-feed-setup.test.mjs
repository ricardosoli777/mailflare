import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-ses-feed-"));
let DB;
after(() => {
	DB?.db.close();
	rmSync(outDir, { recursive: true, force: true });
});

await build({
	entryPoints: {
		feed: join(root, "src/lib/deliverability/ses-feed.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"],
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { setupSesFeed, getSesFeedState } = await load("feed");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

test("the token is stored before SNS is asked to call the endpoint", async () => {
	DB = new SqliteDatabase(join(outDir, "db.sqlite"));
	await applyMigrations(DB, join(root, "drizzle/migrations"));
	const env = { DB, AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_SECRET_ACCESS_KEY: "example", AWS_REGION: "us-east-1" };
	let stored;
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const body = String(input instanceof Request ? await input.clone().text() : init?.body ?? "");
		if (body.includes("Action=Subscribe")) stored = await getSesFeedState(env);
		return new Response("<R><Account>123456789012</Account><Arn>arn:aws:iam::123456789012:user/x</Arn><TopicArn>arn:aws:sns:us-east-1:123456789012:mailflare-feedback</TopicArn></R>");
	};
	try {
		const state = await setupSesFeed(env, "https://mail.example.com");
		assert.ok(stored, "no state when SNS was subscribed");
		assert.equal(stored.token, state.token);
		assert.equal(stored.topicArn, state.topicArn);
	} finally {
		globalThis.fetch = realFetch;
	}
});
