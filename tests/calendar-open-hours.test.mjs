import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outfile = join(mkdtempSync(join(tmpdir(), "mailflare-open-hours-")), "open-hours.mjs");
await build({ entryPoints: [join(root, "src/app/(calendar)/calendar/open-hours-utils.ts")], bundle: true, format: "esm", platform: "node", outfile, alias: { "@": join(root, "src") } });
const { formatMinutes, freeMinutes, openRangesForDay, visibleHours } = await import(pathToFileURL(outfile).href);

const weekdayType = { enabled: true, weekdays: "[1,2,3,4,5]", startTime: "09:00", endTime: "11:00", timeRanges: '[{"startTime":"09:00","endTime":"11:00"}]', timeZone: "UTC" };
// 2026-11-23 is a Monday.
const day = (date) => [new Date(`${date}T00:00:00Z`), new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000)];

test("open hours follow the weekdays of enabled types and merge overlaps", () => {
	const other = { ...weekdayType, timeRanges: '[{"startTime":"10:00","endTime":"12:00"}]' };
	assert.deepEqual(openRangesForDay([weekdayType, other], ...day("2026-11-23"), "UTC"), [{ start: 540, end: 720 }]);
	assert.deepEqual(openRangesForDay([weekdayType], ...day("2026-11-28"), "UTC"), []);
	assert.deepEqual(openRangesForDay([{ ...weekdayType, enabled: false }], ...day("2026-11-23"), "UTC"), []);
});

test("open hours move to the viewer's clock", () => {
	// 09:00-11:00 in São Paulo (UTC-3) is 12:00-14:00 for a viewer on UTC.
	assert.deepEqual(openRangesForDay([{ ...weekdayType, timeZone: "America/Sao_Paulo" }], ...day("2026-11-23"), "UTC"), [{ start: 720, end: 840 }]);
});

test("free minutes leave out the past and busy time", () => {
	const open = [{ start: 540, end: 660 }];
	assert.equal(freeMinutes(open, []), 120);
	assert.equal(freeMinutes(open, [{ start: 570, end: 600 }, { start: 590, end: 610 }]), 80);
	assert.equal(freeMinutes(open, [], 600), 60);
	assert.equal(freeMinutes(open, [], 700), 0);
});

test("the grid shows the windows with padding, within one day", () => {
	assert.deepEqual(visibleHours([{ start: 570, end: 1410 }], 2), { start: 7, end: 24 });
	assert.deepEqual(visibleHours([], 2), { start: 0, end: 24 });
	assert.equal(formatMinutes(0), "0min");
	assert.equal(formatMinutes(125), "2h 5min");
	assert.equal(formatMinutes(120), "2h");
});
