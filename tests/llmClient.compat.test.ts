import assert from "node:assert/strict";
import { analyzeLunchMateAliases } from "../src/agent/lunchMateAgent";
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
globalThis.fetch = (async (_input, init) => {
  assert.equal((init?.headers as Record<string, string>).Accept, "application/json");
  assert.equal((JSON.parse(String(init?.body)) as { stream?: unknown }).stream, false);
  return jsonResponse({ choices: [{ message: { content: "ok" } }] });
}) as typeof fetch;
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

const streamedGroups = JSON.stringify({
  groups: [
    { displayName: "kim-full", aliases: ["kim", "kim-full"], confidence: 0.95 },
    { displayName: "lee", aliases: ["lee"], confidence: 1 },
  ],
});
const encodedStream = new TextEncoder().encode(
  `data: ${JSON.stringify({ choices: [{ delta: { content: streamedGroups } }] })}\n\ndata: [DONE]\n\n`,
);
let streamCanceled = false;
globalThis.fetch = (async (input, init) => {
  assert.equal(String(input), INTERNAL_CHAT_ENDPOINT);
  assert.equal(init?.method, "POST");
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers.Accept, "text/event-stream, application/json");
  const requestBody = JSON.parse(String(init?.body)) as {
    stream?: unknown;
    messages?: Array<{ role?: unknown; content?: unknown }>;
  };
  assert.equal(requestBody.stream, true);
  assert.deepEqual(JSON.parse(String(requestBody.messages?.[1]?.content)), {
    candidates: [
      { name: "kim", count: 2 },
      { name: "kim-full", count: 3 },
      { name: "lee", count: 1 },
    ],
  });
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodedStream);
    },
    cancel() {
      streamCanceled = true;
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}) as typeof fetch;

assert.deepEqual(
  await analyzeLunchMateAliases({
    candidates: [
      { name: "kim", count: 2 },
      { name: "kim-full", count: 3 },
      { name: "lee", count: 1 },
    ],
    endpoint: INTERNAL_CHAT_ENDPOINT,
    apiKey: "test-key",
    model: "internal-model",
  }),
  [
    { displayName: "kim-full", aliases: ["kim", "kim-full"], count: 5, confidence: 0.95 },
    { displayName: "lee", aliases: ["lee"], count: 1, confidence: 1 },
  ],
);
assert.equal(streamCanceled, false);

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
