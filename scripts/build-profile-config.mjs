import { readFileSync } from "node:fs";
import path from "node:path";

export const BUILD_PROFILE_IDS = Object.freeze(["internal", "external"]);

function validateEndpoint(value, expectedPathSuffix, label) {
  if (typeof value !== "string") throw new Error(`${label} Endpoint가 문자열이 아닙니다.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} Endpoint 형식이 올바르지 않습니다.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith(expectedPathSuffix)
  ) {
    throw new Error(`${label} Endpoint가 보안 정책을 충족하지 않습니다.`);
  }
  return parsed.href;
}

export function loadBuildProfile(rootDir, profileId) {
  if (!BUILD_PROFILE_IDS.includes(profileId)) {
    throw new Error(`지원하지 않는 빌드 프로필입니다: ${profileId}`);
  }

  const configPath = path.join(rootDir, "config", "build-profiles.json");
  const raw = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  const candidate = raw?.[profileId];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`빌드 프로필 설정을 찾지 못했습니다: ${profileId}`);
  }

  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
  if (!label || label.length > 40 || /[\r\n]/.test(label)) {
    throw new Error("빌드 프로필 이름이 올바르지 않습니다.");
  }

  const chatEndpoint = validateEndpoint(candidate.chatEndpoint, "/chat/completions", "Chat");
  const modelsEndpoint = validateEndpoint(candidate.modelsEndpoint, "/models", "Models");
  const origin = new URL(chatEndpoint).origin;
  if (origin !== new URL(modelsEndpoint).origin) {
    throw new Error("Chat과 Models Endpoint의 호스트가 일치하지 않습니다.");
  }

  return Object.freeze({
    id: profileId,
    label,
    chatEndpoint,
    modelsEndpoint,
    origin,
    outputDirectoryName: profileId === "internal" ? "dist" : "dist-external",
    extensionNameSuffix: profileId === "internal" ? "" : " (외부망 테스트)",
  });
}

export function createBuildDefines(profile) {
  return {
    __PLANAI_BUILD_PROFILE_ID__: JSON.stringify(profile.id),
    __PLANAI_BUILD_PROFILE_LABEL__: JSON.stringify(profile.label),
    __PLANAI_LLM_CHAT_ENDPOINT__: JSON.stringify(profile.chatEndpoint),
    __PLANAI_LLM_MODELS_ENDPOINT__: JSON.stringify(profile.modelsEndpoint),
  };
}

export function createExtensionCsp(origin) {
  return `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self' ${origin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'`;
}
