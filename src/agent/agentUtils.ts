import {
  requestLlmResponse,
  type LlmChatMessage,
  type LlmGenerationOptions,
} from "./llmClient";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function tryParseJsonLikeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }
  return trimmed;
}

/**
 * LLM 원문에서 JSON 객체를 파싱한다.
 * 파싱에 실패하거나 객체가 아니면 undefined를 반환한다 (throw 하지 않음).
 * 호출 측에서 graceful fallback을 구성할 수 있게 한다.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const jsonText = extractJsonText(raw);
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function pickFirstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

export function pickFirstStringArray(record: Record<string, unknown>, keys: readonly string[], limit = 8): string[] {
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, limit);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit);
    }
  }
  return [];
}

export function normalizeLookupValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function resolveEntityId(
  rawValue: unknown,
  items: Array<{ id: string; name: string }>,
  fallbackId?: string,
): string {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) {
    return fallbackId ?? "";
  }
  const exactMatch = items.find((item) => item.id === trimmed);
  if (exactMatch) {
    return exactMatch.id;
  }
  const normalized = normalizeLookupValue(trimmed);
  const nameMatch = items.find((item) => normalizeLookupValue(item.name) === normalized);
  if (nameMatch) {
    return nameMatch.id;
  }
  return fallbackId ?? "";
}

/** 사용자가 요청을 취소해서 발생한 오류인지 판별한다. */
export function isAbortError(error: unknown): boolean {
  return Boolean(error) && (error as { name?: string }).name === "AbortError";
}

export interface FlexibleToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Model output is untrusted. Keep tool calls small and reject malformed calls
 * before they reach the local data layer. */
export function limitToolCalls<T extends FlexibleToolCall>(calls: T[], maxCalls = 2): T[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = `${call.tool}:${JSON.stringify(call.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxCalls);
}

export function asNonEmptyString(value: unknown, maxLength = 240): string | undefined {
  return typeof value === "string" && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : undefined;
}

/**
 * 모델별 도구 호출 표기 편차를 흡수하는 관대한 파서.
 * - 이름 키: tool / name / tool_name / function.name (OpenAI 네이티브 중첩 형식 포함)
 * - 인자 키: args / arguments / parameters / input / function.arguments
 * - 인자가 JSON 문자열이면 파싱해서 객체로 변환
 * allowedTools에 없는 호출은 버린다.
 */
export function parseFlexibleToolCalls(value: unknown, allowedTools: readonly string[]): FlexibleToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: FlexibleToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const fn = isRecord(item.function) ? item.function : undefined;
    const nameCandidate = [item.tool, item.name, item.tool_name, fn?.name].find(
      (candidate) => typeof candidate === "string" && candidate.trim(),
    );
    if (typeof nameCandidate !== "string") {
      continue;
    }
    const name = nameCandidate.trim();
    if (!allowedTools.includes(name)) {
      continue;
    }
    const argsCandidate = [item.args, item.arguments, item.parameters, item.input, fn?.arguments].find(
      (candidate) => candidate !== undefined && candidate !== null,
    );
    const parsedArgs = tryParseJsonLikeValue(argsCandidate);
    // Empty arguments are valid only for explicitly argument-less tools. The
    // caller still validates each tool's contract before executing it.
    calls.push({ tool: name, args: isRecord(parsedArgs) ? parsedArgs : {} });
  }
  return calls;
}

/** 응답 페이로드에서 도구 호출 배열을 키 이름 편차(toolCalls/tool_calls/actions)까지 감안해 꺼낸다. */
export function pickToolCallsValue(payload: Record<string, unknown>): unknown {
  return payload.toolCalls ?? payload.tool_calls ?? payload.actions;
}

const JSON_RETRY_NUDGE =
  "Your previous reply was not one valid JSON object. Respond again with exactly one valid JSON object matching the required schema — no markdown fences, no text before or after the JSON.";

/**
 * LLM을 호출해 JSON 객체를 기대한다. 파싱에 실패하면 넛지 메시지를 붙여 1회 재시도한다.
 * 두 번 모두 실패하면 payload는 undefined, raw는 마지막 원문이다.
 */
export async function requestJsonWithRetry(params: {
  messages: LlmChatMessage[];
  apiKey: string;
  endpoint?: string;
  model?: string;
  generationOptions?: LlmGenerationOptions;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}): Promise<{ payload?: Record<string, unknown>; raw: string }> {
  const raw = await requestLlmResponse(params);
  const payload = parseJsonObject(raw);
  if (payload) {
    return { payload, raw };
  }

  const retryMessages: LlmChatMessage[] = [
    ...params.messages,
    // A broken reply is context, not a second copy of the whole completion.
    { role: "assistant", content: raw.slice(0, 800) },
    { role: "user", content: JSON_RETRY_NUDGE },
  ];
  const retryRaw = await requestLlmResponse({ ...params, messages: retryMessages });
  return { payload: parseJsonObject(retryRaw), raw: retryRaw };
}

export type { LlmChatMessage, LlmGenerationOptions };
export { requestLlmResponse };
