import { LLM_CHAT_COMPLETIONS_URL, LLM_DEFAULT_MODEL } from "../constants";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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

export async function requestLlmResponse(params: {
  messages: LlmChatMessage[];
  apiKey: string;
  model?: string;
}): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (params.apiKey.trim()) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const response = await fetch(LLM_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: params.model?.trim() || LLM_DEFAULT_MODEL,
      messages: params.messages,
      stream: false,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM 호출 실패 (${response.status}): ${errorBody.slice(0, 240)}`);
  }

  const payload = (await response.json()) as LlmChatResponse;
  const content = readTextContent(payload.choices?.[0]?.message?.content ?? payload.message?.content ?? payload.content);

  if (!content.trim()) {
    throw new Error("LLM 응답에서 텍스트를 찾지 못했습니다.");
  }

  return content.trim();
}
