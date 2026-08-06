import assert from "node:assert/strict";
import { listLlmModels, parseLlmModelList, requestLlmResponse } from "../src/agent/llmClient";
import { LLM_REQUEST_TIMEOUT_MS } from "../src/constants";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});

const INTERNAL_CHAT_ENDPOINT = "https://llm.moip.go.kr/api/chat/completions";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

assert.deepEqual(
  parseLlmModelList(JSON.stringify({
    object: "list",
    data: [
      { id: "z-model", object: "model" },
      { id: "a-model", object: "model" },
      { id: "invalid model id", object: "model" },
    ],
  })),
  ["a-model", "z-model"],
);

const requestedUrls: string[] = [];
globalThis.fetch = (async (input, init) => {
  requestedUrls.push(String(input));
  assert.equal(init?.method, "GET");
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  if (requestedUrls.length === 1) return jsonResponse({ detail: "Not Found" }, 404);
  if (requestedUrls.length === 2) return jsonResponse({ detail: "Method Not Allowed" }, 405);
  return new Response(JSON.stringify({ data: [{ id: "internal-model", object: "model" }] }), { status: 200 });
}) as typeof fetch;

assert.deepEqual(
  await listLlmModels({ apiKey: "test-key", endpoint: INTERNAL_CHAT_ENDPOINT }),
  ["internal-model"],
);
assert.deepEqual(requestedUrls, [
  "https://llm.moip.go.kr/v1/models",
  "https://llm.moip.go.kr/api/v1/models",
  "https://llm.moip.go.kr/api/models",
]);

let unauthorizedRequests = 0;
globalThis.fetch = (async () => {
  unauthorizedRequests += 1;
  return jsonResponse({ detail: "Unauthorized" }, 401);
}) as typeof fetch;

await assert.rejects(
  listLlmModels({ apiKey: "wrong-key", endpoint: INTERNAL_CHAT_ENDPOINT }),
  /모델 목록 인증에 실패했습니다/,
);
assert.equal(unauthorizedRequests, 1);

const scheduledDelays: number[] = [];
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
  scheduledDelays.push(timeout ?? 0);
  return originalSetTimeout(handler, timeout, ...args);
}) as typeof setTimeout;
globalThis.fetch = (async () => jsonResponse({
  choices: [{ message: { content: "ok" } }],
})) as typeof fetch;
try {
  assert.equal(
    await requestLlmResponse({
      messages: [{ role: "user", content: "test" }],
      apiKey: "test-key",
      endpoint: INTERNAL_CHAT_ENDPOINT,
      model: "internal-model",
    }),
    "ok",
  );
} finally {
  globalThis.setTimeout = originalSetTimeout;
}
assert.ok(scheduledDelays.length >= 3);
assert.ok(scheduledDelays.every((delay) => delay === LLM_REQUEST_TIMEOUT_MS));

const canceledController = new AbortController();
canceledController.abort();
globalThis.fetch = (async (_input, init) => {
  if (init?.signal?.aborted) throw new DOMException("signal is aborted without reason", "AbortError");
  return jsonResponse({ choices: [{ message: { content: "unexpected" } }] });
}) as typeof fetch;
await assert.rejects(
  requestLlmResponse({
    messages: [{ role: "user", content: "test" }],
    apiKey: "test-key",
    endpoint: INTERNAL_CHAT_ENDPOINT,
    model: "internal-model",
    signal: canceledController.signal,
  }),
  /AI 요청이 취소되었습니다/,
);

process.stdout.write("LLM compatibility checks passed.\n");
