import assert from "node:assert/strict";
import test from "node:test";
import { turnstileMismatch } from "../src/lib/auth/turnstile-utils.ts";

const request = new Request("https://mail.example.com/api/auth/login");
const ok = { success: true, action: "login", hostname: "mail.example.com" };

test("a token from this screen and host is accepted", () => {
	assert.equal(turnstileMismatch(ok, request, undefined, "login"), null);
	assert.equal(turnstileMismatch({ ...ok, hostname: "app.example.com" }, request, "https://app.example.com", "login"), null);
});

test("a token from another screen or host is refused", () => {
	assert.equal(turnstileMismatch(ok, request, undefined, "password-reset"), "action");
	assert.equal(turnstileMismatch({ ...ok, action: undefined }, request, undefined, "login"), "action");
	assert.equal(turnstileMismatch({ ...ok, hostname: "evil.example.net" }, request, "https://mail.example.com", "login"), "hostname");
	assert.equal(turnstileMismatch({ ...ok, hostname: undefined }, request, undefined, "login"), "hostname");
});

test("Cloudflare's test keys keep working", () => {
	assert.equal(turnstileMismatch({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }, request, undefined, "login"), null);
});
