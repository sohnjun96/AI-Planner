export interface BuildProfile {
  readonly id: "internal" | "external";
  readonly label: string;
  readonly appVersion: string;
  readonly chatEndpoint: string;
  readonly modelsEndpoint: string;
  readonly modelsEndpoints: readonly string[];
  readonly origin: string;
  readonly outputDirectoryName: "dist" | "dist-external";
  readonly extensionNameSuffix: string;
}

export const BUILD_PROFILE_IDS: readonly ["internal", "external"];
export const DEFAULT_LLM_MODEL_BY_PROFILE: Readonly<{
  internal: string;
  external: string;
}>;
export function loadBuildProfile(rootDir: string, profileId: string): BuildProfile;
export function createBuildDefines(
  profile: BuildProfile,
  options?: { readonly defaultLlmModel?: string },
): Record<string, string>;
export function createExtensionCsp(origin: string): string;
