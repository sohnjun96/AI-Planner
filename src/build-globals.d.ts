export {};

declare global {
  const __PLANAI_BUILD_PROFILE_ID__: "internal" | "external";
  const __PLANAI_BUILD_PROFILE_LABEL__: string;
  const __PLANAI_LLM_CHAT_ENDPOINT__: string;
  const __PLANAI_LLM_MODELS_ENDPOINT__: string;
  const __PLANAI_LLM_MODELS_ENDPOINTS__: readonly string[];
}
