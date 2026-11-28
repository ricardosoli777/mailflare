import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = mkdtempSync(join(tmpdir(), "maillead-ses-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function load(source, name) {
	const outfile = join(outDir, `${name}.mjs`);
	await build({ entryPoints: [fileURLToPath(new URL(source, import.meta.url))], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent", tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
	return import(pathToFileURL(outfile).href);
}

test("a sealed secret opens only with its key", async () => {
	const box = await load("../src/lib/aws/secret-box.ts", "box");
	const sealed = await box.seal('{"secretAccessKey":"abc123"}', "chave-1");
	assert.ok(box.isSealed(sealed));
	assert.ok(!sealed.includes("abc123"));
	assert.equal(await box.open(sealed, "chave-1"), '{"secretAccessKey":"abc123"}');
	assert.equal(await box.open(sealed, "chave-2"), null);
	assert.equal(await box.open(sealed, undefined), null);
});

test("role addresses are recognised, ordinary business addresses are not", async () => {
	const { isRoleAddress } = await load("../src/lib/marketing/contacts-utils.ts", "contacts");
	for (const email of ["abuse@x.com", "postmaster@x.com", "no-reply@x.com", "abuse+a@x.com"]) assert.equal(isRoleAddress(email), true, email);
	for (const email of ["contato@x.com", "info@x.com", "maria@x.com"]) assert.equal(isRoleAddress(email), false, email);
});
