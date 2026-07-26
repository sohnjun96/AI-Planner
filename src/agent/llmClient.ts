import {
  clampLlmTemperature,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  LLM_DEFAULT_MODEL,
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
  generationOptions?: LlmGenerationOptions;
}

export function generationOptionsFromSetting(setting?: AppSetting): LlmGenerationOptions {
  return {
    temperature: clampLlmTemperature(setting?.llmTemperature),
    reasoningEffort: normalizeLlmReasoningEffort(setting?.llmReasoningEffort),
    gemmaThinkingEnabled: normalizeLlmGemmaThinkingEnabled(setting?.llmGemmaThinkingEnabled),
  };
}

export function isGemma4ThinkingModel(model?: string): boolean {
  const normalized = model?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
  return (
    normalized.includes("gemma4") &&
    normalized.includes("26b") &&
    (normalized.includes("a4b") || normalized.includes("moe"))
  );
}

export function buildLlmChatRequestBody(params: BuildLlmChatRequestBodyParams): Record<string, unknown> {
  const model = params.model?.trim() || LLM_DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    stream: params.stream ?? false,
    temperature: clampLlmTemperature(params.generationOptions?.temperature),
  };

  const reasoningEffort = normalizeLlmReasoningEffort(params.generationOptions?.reasoningEffort);
  if (reasoningEffort !== "default") {
    body.reasoning_effort = reasoningEffort;
  }

  if (isGemma4ThinkingModel(model)) {
    const enableThinking = normalizeLlmGemmaThinkingEnabled(params.generationOptions?.gemmaThinkingEnabled);
    body.chat_template_kwargs = { enable_thinking: enableThinking };
    if (enableThinking) {
      body.skip_special_tokens = false;
    }
  }

  return body;
}

interface LlmChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  message?: {
    content?: unknown;
  };
  content?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (!item || typeof item !== "object") {
          return "";
        }

        const maybeText = item as { text?: unknown };
        return typeof maybeText.text === "string" ? maybeText.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    const maybeText = content as { text?: unknown; content?: unknown };
    if (typeof maybeText.text === "string") {
      return maybeText.text;
    }
    if (typeof maybeText.content === "string") {
      return maybeText.content;
    }
  }

  return "";
}

/** SSE(text/event-stream) 응답을 읽어 델타를 누적하고, 토큰마다 onToken을 호출한다. */
async function readSseStream(body: ReadableStream<Uint8Array>, onToken: (delta: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
        };
        const choice = json.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content;
        if (typeof delta === "string" && delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // 부분 청크 등 파싱 실패는 무시하고 계속 읽는다.
      }
    }
  }

  return full;
}

export async function requestLlmResponse(params: {
  messages: LlmChatMessage[];
  apiKey: string;
  endpoint?: string;
  model?: string;
  generationOptions?: LlmGenerationOptions;
  onToken?: (delta: string) => void;
  /** 요청 취소용. 모달을 닫거나 새 요청을 보낼 때 이전 fetch를 중단한다. */
  signal?: AbortSignal;
}): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (params.apiKey.trim()) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const useStream = typeof params.onToken === "function";

  const response = await fetch(params.endpoint?.trim() || DEFAULT_LLM_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    signal: params.signal,
    body: JSON.stringify(
      buildLlmChatRequestBody({
        model: params.model,
        messages: params.messages,
        stream: useStream,
        generationOptions: params.generationOptions,
      }),
    ),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM 호출 실패 (${response.status}): ${errorBody.slice(0, 240)}`);
  }

  // 통계용: 서버가 usage를 안 주면 문자 수로 추정한다 (설정 > 통계에 표시)
  const promptChars = params.messages.reduce((sum, message) => sum + message.content.length, 0);

  // 스트리밍 요청이고 서버가 실제 event-stream을 반환하면 SSE로 처리한다.
  const contentType = response.headers.get("content-type") ?? "";
  if (useStream && response.body && contentType.includes("text/event-stream")) {
    const streamed = await readSseStream(response.body, params.onToken!);
    if (!streamed.trim()) {
      throw new Error("LLM 응답에서 텍스트를 찾지 못했습니다.");
    }
    recordAiUsage({
      promptTokens: estimateTokensFromChars(promptChars),
      completionTokens: estimateTokensFromChars(streamed.length),
      estimated: true,
    });
    return streamed.trim();
  }

  // 그 외(스트림 미지원 서버가 일반 JSON을 반환한 경우 포함)는 JSON으로 폴백한다.
  const payload = (await response.json()) as LlmChatResponse;
  const content = readTextContent(payload.choices?.[0]?.message?.content ?? payload.message?.content ?? payload.content);

  if (!content.trim()) {
    throw new Error("LLM 응답에서 텍스트를 찾지 못했습니다.");
  }

  const usage = payload.usage;
  if (usage && typeof usage.prompt_tokens === "number") {
    recordAiUsage({
      promptTokens: usage.prompt_tokens,
      completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
      estimated: false,
    });
  } else {
    recordAiUsage({
      promptTokens: estimateTokensFromChars(promptChars),
      completionTokens: estimateTokensFromChars(content.length),
      estimated: true,
    });
  }

  return content.trim();
}
