export interface BuildProfile {
  readonly id: "internal" | "external";
  readonly label: string;
  readonly chatEndpoint: string;
  readonly modelsEndpoint: string;
  readonly origin: string;
  readonly outputDirectoryName: "dist" | "dist-external";
  readonly extensionNameSuffix: string;
}

export const BUILD_PROFILE_IDS: readonly ["internal", "external"];
export function loadBuildProfile(rootDir: string, profileId: string): BuildProfile;
export function createBuildDefines(profile: BuildProfile): Record<string, string>;
export function createExtensionCsp(origin: string): string;
