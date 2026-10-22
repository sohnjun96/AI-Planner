import assert from "node:assert/strict";
import { buildLlmChatRequestBody, requestLlmResponse } from "../src/agent/llmClient";
import {
  BUILD_PROFILE_ID,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  LLM_DEFAULT_MODEL,
  LLM_MAX_COMPLETION_TOKENS,
  LLM_MAX_ERROR_BYTES,
  LLM_REQUEST_TIMEOUT_MS,
} from "../src/constants";

const originalFetch = globalThis.fetch;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalSetTimeout = globalThis.setTimeout;
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

const tokenField = BUILD_PROFILE_ID === "external" ? "max_completion_tokens" : "max_tokens";
const alternateTokenField = tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens";
const messages = [{ role: "user" as const, content: "synthetic compatibility fixture" }];
const base = {
  messages,
  apiKey: "synthetic-test-key",
  endpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  model: "chatgpt-latest",
  maxTokens: 123,
  generationOptions: { temperature: 0.25, reasoningEffort: "low" as const },
};
const rawServerMessage = "SYNTHETIC_PRIVATE_SERVER_MESSAGE";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function unsupported(param: string, code = "unsupported_parameter", status = 400): Response {
  return jsonResponse({ error: { type: "invalid_request_error", param, code, message: rawServerMessage } }, status);
}

function success(stream = false): Response {
  if (!stream) return jsonResponse({ choices: [{ message: { content: "ok" } }] });
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

interface SentRequest {
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}

function mockRequests(respond: (request: SentRequest, index: number) => Response | Promise<Response>): SentRequest[] {
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), DEFAULT_LLM_CHAT_COMPLETIONS_URL);
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(init?.headers, {
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream, application/json" : "application/json",
      Authorization: "Bearer synthetic-test-key",
    });
    const request = { body, signal: init?.signal };
    sent.push(request);
    if (sent.length > 1) assert.equal(request.signal, sent[0].signal, "재시도는 기존 취소/시간 제한 범위를 유지한다.");
    return respond(request, sent.length - 1);
  }) as typeof fetch;
  return sent;
}

function assertBodyChanges(before: Record<string, unknown>, after: Record<string, unknown>, change: "tokens" | "temperature"): void {
  const expected = { ...before };
  if (change === "tokens") {
    expected[alternateTokenField] = expected[tokenField];
    delete expected[tokenField];
  } else {
    delete expected.temperature;
  }
  assert.deepEqual(after, expected, "명시적으로 거부된 매개변수 외의 요청 내용은 유지한다.");
}

async function assertNoRetry(makeResponse: () => Response, expectedError?: RegExp): Promise<void> {
  const sent = mockRequests(() => makeResponse());
  await assert.rejects(requestLlmResponse(base), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(rawServerMessage), "서버 원문 오류는 사용자에게 노출하지 않는다.");
    if (expectedError) assert.match(error.message, expectedError);
    return true;
  });
  assert.equal(sent.length, 1);
}

try {
  const defaultBody = buildLlmChatRequestBody({ messages });
  assert.equal(defaultBody.model, LLM_DEFAULT_MODEL);
  assert.equal(defaultBody[tokenField], LLM_MAX_COMPLETION_TOKENS);
  assert.equal(defaultBody[alternateTokenField], undefined);
  assert.equal(defaultBody.temperature, 0);
  assert.equal(defaultBody.stream, false);
  assert.equal(defaultBody.reasoning_effort, undefined);
  for (const [maxTokens, expected] of [[0, 1], [-100, 1], [12.9, 12], [100_000, 4_096], [NaN, 4_096], [Infinity, 4_096]]) {
    const body = buildLlmChatRequestBody({ messages, model: "chatgpt-latest", maxTokens });
    assert.equal(body[tokenField], expected);
    assert.equal(body[alternateTokenField], undefined);
  }
  const gemma = buildLlmChatRequestBody({
    messages,
    model: "gemma4-26b-moe",
    generationOptions: { temperature: 9, reasoningEffort: "high", gemmaThinkingEnabled: true },
  });
  assert.equal(gemma.temperature, 2);
  assert.equal(gemma.reasoning_effort, "high");
  assert.deepEqual(gemma.chat_template_kwargs, { enable_thinking: true });
  assert.equal(gemma.skip_special_tokens, false);
  const gemmaDefault = buildLlmChatRequestBody({ messages, model: "gemma4-26b-moe" });
  assert.deepEqual(gemmaDefault.chat_template_kwargs, { enable_thinking: false });
  assert.equal(gemmaDefault.skip_special_tokens, undefined);

  // 각 프로필에서 반대쪽 토큰 필드로의 전환과 이후 요청의 기본값 복원을 확인한다.
  for (let independentRequest = 0; independentRequest < 2; independentRequest += 1) {
    const sent = mockRequests((_request, index) => index === 0 ? unsupported(tokenField) : success());
    assert.equal(await requestLlmResponse(base), "ok");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body[tokenField], 123);
    assert.equal(sent[0].body[alternateTokenField], undefined);
    assertBodyChanges(sent[0].body, sent[1].body, "tokens");
  }

  // JSON 및 SSE 모두 같은 제한된 재시도 경로를 사용한다.
  for (const stream of [false, true]) {
    for (const temperatureFirst of [false, true]) {
      const chunks: string[] = [];
      const delays: number[] = [];
      if (stream) {
        globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
          delays.push(timeout ?? 0);
          return originalSetTimeout(handler, timeout, ...args);
        }) as typeof setTimeout;
      }
      const sent = mockRequests((_request, index) => {
        if (index === 0) return unsupported(temperatureFirst ? "temperature" : tokenField, temperatureFirst ? "unsupported_value" : "unsupported_parameter");
        if (index === 1) return unsupported(temperatureFirst ? tokenField : "temperature");
        return success(stream);
      });
      try {
        assert.equal(await requestLlmResponse({ ...base, ...(stream ? { onToken: (delta: string) => chunks.push(delta) } : {}) }), "ok");
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
      assert.equal(sent.length, 3);
      assertBodyChanges(sent[0].body, sent[1].body, temperatureFirst ? "temperature" : "tokens");
      assertBodyChanges(sent[1].body, sent[2].body, temperatureFirst ? "tokens" : "temperature");
      if (stream) {
        assert.deepEqual(chunks, ["ok"]);
        assert.equal(delays.filter((delay) => delay === LLM_REQUEST_TIMEOUT_MS).length, 1, "재시도로 전체 요청 제한 시간을 연장하지 않는다.");
      }
    }
  }

  const repeatedTokenErrors = mockRequests((_request, index) => unsupported(index === 0 ? tokenField : alternateTokenField));
  await assert.rejects(requestLlmResponse(base), /상태 코드: 400/);
  assert.equal(repeatedTokenErrors.length, 2, "토큰 필드는 요청당 한 번만 전환한다.");

  const repeatedTemperatureErrors = mockRequests(() => unsupported("temperature", "unsupported_value"));
  await assert.rejects(requestLlmResponse(base), /상태 코드: 400/);
  assert.equal(repeatedTemperatureErrors.length, 2, "이미 제거한 temperature 오류로 계속 재시도하지 않는다.");

  const maximumAttempts = mockRequests((_request, index) => unsupported(index === 1 ? "temperature" : tokenField));
  await assert.rejects(requestLlmResponse(base), /상태 코드: 400/);
  assert.equal(maximumAttempts.length, 3);

  for (const status of [401, 403, 429, 500, 503]) await assertNoRetry(() => unsupported(tokenField, "unsupported_parameter", status));
  for (const error of [
    { type: "invalid_request_error", param: tokenField, code: "invalid_value" },
    { type: "invalid_request_error", param: tokenField, code: "unsupported_value" },
    { type: "server_error", param: tokenField, code: "unsupported_parameter" },
    { param: tokenField, code: "unsupported_parameter" },
    { type: "invalid_request_error", param: "unrelated", code: "unsupported_parameter" },
    { type: "invalid_request_error", param: alternateTokenField, code: "unsupported_parameter" },
    { type: "invalid_request_error", param: "temperature", code: "invalid_value" },
  ]) await assertNoRetry(() => jsonResponse({ error: { ...error, message: rawServerMessage } }, 400));
  for (const payload of [null, [], 12, { error: rawServerMessage }, { message: `Unsupported parameter: '${tokenField}' ${rawServerMessage}` }]) {
    await assertNoRetry(() => jsonResponse(payload, 400));
  }
  await assertNoRetry(() => new Response(`invalid JSON ${rawServerMessage}`, { status: 400 }));
  await assertNoRetry(() => new Response(JSON.stringify({ error: { type: "invalid_request_error", param: tokenField, code: "unsupported_parameter" } }) + " ".repeat(LLM_MAX_ERROR_BYTES), {
    status: 400, headers: { "Content-Type": "application/json" },
  }));
  await assertNoRetry(() => new Response(JSON.stringify({ error: { type: "invalid_request_error", param: tokenField, code: "unsupported_parameter" } }), {
    status: 400, headers: { "Content-Type": "application/json", "Content-Length": String(LLM_MAX_ERROR_BYTES + 1) },
  }), /응답 크기/);

  const failedNetwork = mockRequests(() => { throw new TypeError("synthetic connection failure"); });
  await assert.rejects(requestLlmResponse(base), /synthetic connection failure/);
  assert.equal(failedNetwork.length, 1);

  const canceled = new AbortController();
  const canceledRetry = mockRequests((_request, index) => {
    if (index === 0) return unsupported(tokenField);
    canceled.abort();
    throw new DOMException("synthetic cancellation", "AbortError");
  });
  await assert.rejects(requestLlmResponse({ ...base, signal: canceled.signal }), /AI 요청이 취소되었습니다/);
  assert.equal(canceledRetry.length, 2);
  assert.equal(canceledRetry[1].signal?.aborted, true);

  const canceledBeforeRetry = new AbortController();
  const canceledErrorResponse = mockRequests(() => {
    canceledBeforeRetry.abort();
    return unsupported(tokenField);
  });
  await assert.rejects(requestLlmResponse({ ...base, signal: canceledBeforeRetry.signal }), /AI 요청이 취소되었습니다/);
  assert.equal(canceledErrorResponse.length, 1);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  if (originalWindowDescriptor) Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
}

process.stdout.write(`LLM parameter compatibility checks passed (${BUILD_PROFILE_ID}).\n`);
