import {
  clampLlmTemperature,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_LLM_MODELS_URLS,
  isValidLlmModelId,
  LLM_DEFAULT_MODEL,
  LLM_IDLE_TIMEOUT_MS,
  LLM_MAX_API_KEY_LENGTH,
  LLM_MAX_COMPLETION_TOKENS,
  LLM_MAX_ERROR_BYTES,
  LLM_MAX_MESSAGE_COUNT,
  LLM_MAX_MODEL_COUNT,
  LLM_MAX_MODEL_LIST_BYTES,
  LLM_MAX_RESPONSE_BYTES,
  LLM_MAX_TOTAL_PROMPT_CHARS,
  LLM_MODEL_LIST_TIMEOUT_MS,
  LLM_REQUEST_TIMEOUT_MS,
  normalizeLlmGemmaThinkingEnabled,
  normalizeLlmReasoningEffort,
} from "../constants";
import type { AppSetting, LlmReasoningEffort } from "../models";
import { estimateTokensFromChars, recordAiUsage } from "../utils/aiUsage";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGenerationOptions {
  temperature?: number;
  reasoningEffort?: LlmReasoningEffort;
  gemmaThinkingEnabled?: boolean;
}

export interface BuildLlmChatRequestBodyParams {
  messages: LlmChatMessage[];
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  generationOptions?: LlmGenerationOptions;
}

interface LlmChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  message?: { content?: unknown };
  content?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const MAX_CONCURRENT_LLM_REQUESTS = 2;
let activeLlmRequests = 0;

export function generationOptionsFromSetting(setting?: AppSetting): LlmGenerationOptions {
  return {
    temperature: clampLlmTemperature(setting?.llmTemperature),
    reasoningEffort: normalizeLlmReasoningEffort(setting?.llmReasoningEffort),
    gemmaThinkingEnabled: normalizeLlmGemmaThinkingEnabled(setting?.llmGemmaThinkingEnabled),
  };
}

export function isGemma4ThinkingModel(model?: string): boolean {
  const normalized = model?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
  return normalized.includes("gemma4") && normalized.includes("26b") && (normalized.includes("a4b") || normalized.includes("moe"));
}

export function validateLlmEndpoint(endpoint?: string): string {
  const candidate = endpoint?.trim() || DEFAULT_LLM_CHAT_COMPLETIONS_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("승인된 AI Endpoint 주소가 아닙니다.");
  }

  if (
    parsed.href !== DEFAULT_LLM_CHAT_COMPLETIONS_URL ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new Error("AI Endpoint는 승인된 MOIP 주소만 사용할 수 있습니다.");
  }
  return DEFAULT_LLM_CHAT_COMPLETIONS_URL;
}

function normalizeModel(model?: string): string {
  const normalized = model?.trim() || LLM_DEFAULT_MODEL;
  if (!isValidLlmModelId(normalized)) {
    throw new Error("LLM 모델명 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length > LLM_MAX_API_KEY_LENGTH || /[\r\n]/.test(normalized)) {
    throw new Error("API 키 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function getLlmModelsEndpoints(endpoint?: string): readonly string[] {
  validateLlmEndpoint(endpoint);
  return DEFAULT_LLM_MODELS_URLS;
}

class ModelListCompatibilityError extends Error {}

export function parseLlmModelList(raw: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new ModelListCompatibilityError("모델 목록의 JSON 응답 형식이 올바르지 않습니다.");
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new ModelListCompatibilityError("모델 목록이 OpenAI 호환 형식이 아닙니다.");
  }

  const data = (payload as { data: unknown[] }).data;
  if (data.length > LLM_MAX_MODEL_COUNT) {
    throw new Error(`모델 목록이 허용 개수(${LLM_MAX_MODEL_COUNT}개)를 초과했습니다.`);
  }

  const modelIds = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) continue;
    try {
      modelIds.add(normalizeModel(id));
    } catch {
      // 허용되지 않은 외부 모델 식별자는 선택 목록에 노출하지 않는다.
    }
  }

  if (data.length > 0 && modelIds.size === 0) {
    throw new ModelListCompatibilityError("사용 가능한 형식의 모델 식별자를 찾지 못했습니다.");
  }
  return [...modelIds].sort((left, right) => left.localeCompare(right, "en"));
}

function validateMessages(messages: LlmChatMessage[]): LlmChatMessage[] {
  if (messages.length === 0 || messages.length > LLM_MAX_MESSAGE_COUNT) {
    throw new Error("AI 요청 메시지 수가 허용 범위를 벗어났습니다.");
  }

  let totalChars = 0;
  return messages.map((message) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new Error("AI 요청 메시지 형식이 올바르지 않습니다.");
    }
    totalChars += message.content.length;
    if (totalChars > LLM_MAX_TOTAL_PROMPT_CHARS) {
      throw new Error("AI 요청 데이터가 허용 크기를 초과했습니다.");
    }
    return { role: message.role, content: message.content };
  });
}

export function buildLlmChatRequestBody(params: BuildLlmChatRequestBodyParams): Record<string, unknown> {
  const model = normalizeModel(params.model);
  const maxTokens = Number.isFinite(params.maxTokens)
    ? Math.max(1, Math.min(LLM_MAX_COMPLETION_TOKENS, Math.floor(params.maxTokens ?? LLM_MAX_COMPLETION_TOKENS)))
    : LLM_MAX_COMPLETION_TOKENS;
  const body: Record<string, unknown> = {
    model,
    messages: validateMessages(params.messages),
    stream: params.stream ?? false,
    temperature: clampLlmTemperature(params.generationOptions?.temperature),
    max_tokens: maxTokens,
  };

  const reasoningEffort = normalizeLlmReasoningEffort(params.generationOptions?.reasoningEffort);
  if (reasoningEffort !== "default") {
    body.reasoning_effort = reasoningEffort;
  }
  if (isGemma4ThinkingModel(model)) {
    const enableThinking = normalizeLlmGemmaThinkingEnabled(params.generationOptions?.gemmaThinkingEnabled);
    body.chat_template_kwargs = { enable_thinking: enableThinking };
    if (enableThinking) body.skip_special_tokens = false;
  }
  return body;
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const value = content as { text?: unknown; content?: unknown };
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function assertContentLength(response: Response, maxBytes: number): void {
  const raw = response.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
    throw new Error("AI 응답 크기가 허용 한도를 초과했습니다.");
  }
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onActivity: () => void,
): Promise<string> {
  if (!body) throw new Error("AI 응답 본문이 없습니다.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        text += decoder.decode();
        break;
      }
      onActivity();
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw new Error("AI 응답 크기가 허용 한도를 초과했습니다.");
      text += decoder.decode(value, { stream: true });
    }
    return text;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onToken: (delta: string) => void,
  onActivity: () => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let buffer = "";
  let full = "";
  let pending = "";
  let lastFlush = performance.now();
  let completed = false;

  const flush = () => {
    if (!pending) return;
    onToken(pending);
    pending = "";
    lastFlush = performance.now();
  };

  try {
    stream: for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        buffer += decoder.decode();
        break;
      }
      onActivity();
      totalBytes += value.byteLength;
      if (totalBytes > LLM_MAX_RESPONSE_BYTES) throw new Error("AI 스트림 응답 크기가 허용 한도를 초과했습니다.");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 128_000) throw new Error("AI 스트림 형식이 올바르지 않습니다.");

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          completed = true;
          break stream;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
          };
          const choice = json.choices?.[0];
          const delta = choice?.delta?.content ?? choice?.message?.content;
          if (typeof delta === "string" && delta) {
            if (full.length + delta.length > LLM_MAX_RESPONSE_BYTES) {
              throw new Error("AI 응답 텍스트가 허용 한도를 초과했습니다.");
            }
            full += delta;
            pending += delta;
            if (pending.length >= 2_048 || performance.now() - lastFlush >= 50) flush();
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("허용 한도")) throw error;
        }
      }
    }
    flush();
    return full;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function createAbortScope(
  externalSignal?: AbortSignal,
  totalTimeoutMs = LLM_REQUEST_TIMEOUT_MS,
  idleTimeoutMs = LLM_IDLE_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const totalTimer = window.setTimeout(() => controller.abort(), totalTimeoutMs);
  let idleTimer = window.setTimeout(() => controller.abort(), idleTimeoutMs);
  const activity = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  const cleanup = () => {
    window.clearTimeout(totalTimer);
    window.clearTimeout(idleTimer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  };
  return { signal: controller.signal, activity, cleanup };
}

export async function listLlmModels(params: {
  apiKey: string;
  endpoint?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const abortScope = createAbortScope(
    params.signal,
    LLM_MODEL_LIST_TIMEOUT_MS,
    LLM_MODEL_LIST_TIMEOUT_MS,
  );
  try {
    const apiKey = validateApiKey(params.apiKey);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const endpoints = getLlmModelsEndpoints(params.endpoint);
    let lastCompatibilityError: Error | undefined;
    let emptyResult: string[] | undefined;

    for (let index = 0; index < endpoints.length; index += 1) {
      const response = await fetch(endpoints[index], {
        method: "GET",
        headers,
        signal: abortScope.signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      abortScope.activity();

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if ((response.status === 404 || response.status === 405) && index < endpoints.length - 1) {
          lastCompatibilityError = new Error(`모델 목록 API를 찾지 못했습니다. 상태 코드: ${response.status}`);
          continue;
        }
        if (response.status === 401) throw new Error("모델 목록 인증에 실패했습니다. API 키를 확인해 주세요.");
        if (response.status === 403) throw new Error("모델 목록을 조회할 권한이 없습니다.");
        if (response.status === 429) throw new Error("모델 목록 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
        throw new Error(`모델 목록을 불러오지 못했습니다. 상태 코드: ${response.status}`);
      }

      assertContentLength(response, LLM_MAX_MODEL_LIST_BYTES);
      const raw = await readBodyWithLimit(response.body, LLM_MAX_MODEL_LIST_BYTES, abortScope.activity);
      try {
        const models = parseLlmModelList(raw);
        if (models.length > 0) return models;
        emptyResult = models;
      } catch (error) {
        if (!(error instanceof ModelListCompatibilityError) || index === endpoints.length - 1) throw error;
        lastCompatibilityError = error;
      }
    }

    if (emptyResult) return emptyResult;
    throw lastCompatibilityError ?? new Error("모델 목록을 불러오지 못했습니다.");
  } catch (error) {
    if (abortScope.signal.aborted && !params.signal?.aborted) {
      throw new Error("모델 목록 요청 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    abortScope.cleanup();
  }
}

function recordBoundedUsage(promptChars: number, contentChars: number, usage?: LlmChatResponse["usage"]): void {
  const bounded = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(10_000_000, Math.floor(value)))
    : undefined;
  const promptTokens = bounded(usage?.prompt_tokens);
  const completionTokens = bounded(usage?.completion_tokens);
  recordAiUsage(
    promptTokens === undefined
      ? {
          promptTokens: estimateTokensFromChars(promptChars),
          completionTokens: estimateTokensFromChars(contentChars),
          estimated: true,
        }
      : { promptTokens, completionTokens: completionTokens ?? 0, estimated: false },
  );
}

export async function requestLlmResponse(params: {
  messages: LlmChatMessage[];
  apiKey: string;
  endpoint?: string;
  model?: string;
  generationOptions?: LlmGenerationOptions;
  maxTokens?: number;
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if (activeLlmRequests >= MAX_CONCURRENT_LLM_REQUESTS) {
    throw new Error("동시에 처리할 수 있는 AI 요청 수를 초과했습니다. 잠시 후 다시 시도해 주세요.");
  }
  activeLlmRequests += 1;
  const useStream = typeof params.onToken === "function";
  const abortScope = createAbortScope(
    params.signal,
    LLM_REQUEST_TIMEOUT_MS,
    useStream ? LLM_IDLE_TIMEOUT_MS : LLM_REQUEST_TIMEOUT_MS,
  );
  try {
    const apiKey = validateApiKey(params.apiKey);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: useStream ? "text/event-stream, application/json" : "application/json",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const messages = validateMessages(params.messages);
    const response = await fetch(validateLlmEndpoint(params.endpoint), {
      method: "POST",
      headers,
      signal: abortScope.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      body: JSON.stringify(
        buildLlmChatRequestBody({
          model: params.model,
          messages,
          stream: useStream,
          maxTokens: params.maxTokens,
          generationOptions: params.generationOptions,
        }),
      ),
    });
    abortScope.activity();
    assertContentLength(response, response.ok ? LLM_MAX_RESPONSE_BYTES : LLM_MAX_ERROR_BYTES);

    if (!response.ok) {
      await readBodyWithLimit(response.body, LLM_MAX_ERROR_BYTES, abortScope.activity).catch(() => "");
      throw new Error(`LLM 호출에 실패했습니다. 상태 코드: ${response.status}`);
    }

    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (useStream && response.body && contentType.includes("text/event-stream")) {
      const streamed = await readSseStream(response.body, params.onToken!, abortScope.activity);
      if (!streamed.trim()) throw new Error("LLM 응답에서 텍스트를 찾지 못했습니다.");
      recordBoundedUsage(promptChars, streamed.length);
      return streamed.trim();
    }
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("LLM 서버가 허용되지 않은 응답 형식을 반환했습니다.");
    }

    const raw = await readBodyWithLimit(response.body, LLM_MAX_RESPONSE_BYTES, abortScope.activity);
    let payload: LlmChatResponse;
    try {
      payload = JSON.parse(raw) as LlmChatResponse;
    } catch {
      throw new Error("LLM 서버의 JSON 응답 형식이 올바르지 않습니다.");
    }
    const content = readTextContent(payload.choices?.[0]?.message?.content ?? payload.message?.content ?? payload.content);
    if (!content.trim()) throw new Error("LLM 응답에서 텍스트를 찾지 못했습니다.");
    recordBoundedUsage(promptChars, content.length, payload.usage);
    return content.trim();
  } catch (error) {
    if (abortScope.signal.aborted) {
      if (params.signal?.aborted) {
        throw new Error("AI 요청이 취소되었습니다.");
      }
      throw new Error("AI 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw error;
  } finally {
    abortScope.cleanup();
    activeLlmRequests -= 1;
  }
}
