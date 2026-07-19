import { pickFirstString, requestJsonWithRetry, type LlmGenerationOptions } from "./agentUtils";

export async function generateNoteTitleWithAi(input: {
  content: string;
  endpoint?: string;
  apiKey: string;
  model?: string;
  generationOptions?: LlmGenerationOptions;
  signal?: AbortSignal;
}): Promise<string> {
  const { payload } = await requestJsonWithRetry({
    messages: [
      {
        role: "system",
        content: `You create a concise Korean title for a note.
Return exactly one JSON object: {"title":"short Korean title"}.
Summarize the note's main subject in a natural noun phrase.
Do not add quotation marks, markdown, trailing punctuation, or text outside the JSON object.
Keep the title within 30 Korean characters.`,
      },
      {
        role: "user",
        content: input.content.slice(0, 6000),
      },
    ],
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    model: input.model,
    generationOptions: input.generationOptions,
    signal: input.signal,
  });

  const title = payload ? pickFirstString(payload, ["title"]) : "";
  if (!title) {
    throw new Error("AI 제목을 생성하지 못했습니다.");
  }
  return title.replace(/[.!?。！？]+$/u, "").slice(0, 50);
}
