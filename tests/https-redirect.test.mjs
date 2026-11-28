import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = mkdtempSync(join(tmpdir(), "maillead-https-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

test("plain HTTP is redirected on public hosts only", async () => {
	const outfile = join(outDir, "worker-utils.mjs");
	await build({ entryPoints: [fileURLToPath(new URL("../worker-utils.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
	const { httpsRedirectTarget } = await import(pathToFileURL(outfile).href);
	const target = (value) => httpsRedirectTarget(new URL(value));
	assert.equal(target("http://mail.example.com/login?a=1"), "https://mail.example.com/login?a=1");
	assert.equal(target("https://mail.example.com/login"), null);
	for (const local of ["http://localhost:3000/", "http://127.0.0.1:8787/", "http://[::1]/", "http://app.test/"]) assert.equal(target(local), null);
});
