import assert from "node:assert/strict";
import { toSeoulIso } from "../src/utils/date";
import { runScheduleAgent } from "../src/agent/scheduleAgent";

for (const [utc, seoul] of [
  ["2026-09-15T04:10:00.000Z", "2026-09-15T13:10:00.000+09:00"],
  ["2026-09-14T15:10:00.000Z", "2026-09-15T00:10:00.000+09:00"],
  ["2026-12-31T15:00:00.000Z", "2027-01-01T00:00:00.000+09:00"],
]) {
  assert.equal(toSeoulIso(new Date(utc)), seoul);
  assert.equal(new Date(toSeoulIso(new Date(utc))).getTime(), Date.parse(utc));
}

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
const originalFetch = globalThis.fetch;
let calls = 0;
const before = Date.now();
try {
  globalThis.fetch = (async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    const payload = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    assert.equal(payload.timeZone, "Asia/Seoul");
    assert.match(payload.now, /T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/);
    assert.ok(Date.parse(payload.now) >= before && Date.parse(payload.now) <= Date.now());
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      assistantMessage: "현재 한국 시각을 확인했습니다.", needsUserInput: false,
      userQuestion: "", toolCalls: [], contextSuggestions: [], proposal: null,
    }) } }] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  await runScheduleAgent({ userMessage: "지금 몇 시야?", conversation: [], tasks: [], projects: [], taskTypes: [], apiKey: "test-key" });
  assert.equal(calls, 1);
} finally {
  globalThis.fetch = originalFetch;
}
process.stdout.write("Schedule Korean time payload checks passed.\n");
