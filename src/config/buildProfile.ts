export type BuildProfileId = "internal" | "external";

function validateBuildEndpoint(value: string, expectedPathSuffix: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("빌드 프로필의 AI Endpoint 형식이 올바르지 않습니다.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith(expectedPathSuffix)
  ) {
    throw new Error("빌드 프로필의 AI Endpoint가 보안 정책을 충족하지 않습니다.");
  }
  return parsed.href;
}

const profileId = __PLANAI_BUILD_PROFILE_ID__;
if (profileId !== "internal" && profileId !== "external") {
  throw new Error("지원하지 않는 빌드 프로필입니다.");
}

const label = __PLANAI_BUILD_PROFILE_LABEL__.trim();
if (!label || label.length > 40 || /[\r\n]/.test(label)) {
  throw new Error("빌드 프로필 이름이 올바르지 않습니다.");
}

const chatEndpoint = validateBuildEndpoint(__PLANAI_LLM_CHAT_ENDPOINT__, "/chat/completions");
const modelsEndpoint = validateBuildEndpoint(__PLANAI_LLM_MODELS_ENDPOINT__, "/models");
if (new URL(chatEndpoint).origin !== new URL(modelsEndpoint).origin) {
  throw new Error("Chat과 Models Endpoint의 호스트가 일치하지 않습니다.");
}

export const BUILD_PROFILE = Object.freeze({
  id: profileId,
  label,
  chatEndpoint,
  modelsEndpoint,
});
