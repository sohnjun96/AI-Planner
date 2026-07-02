import { requestLlmResponse, type LlmChatMessage } from "./llmClient";

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

export type { LlmChatMessage };
export { requestLlmResponse };
