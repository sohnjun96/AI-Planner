import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildDefines, loadBuildProfile } from "./build-profile-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = loadBuildProfile(rootDir, "internal");
const result = await build({
  absWorkingDir: rootDir,
  entryPoints: ["tests/llmClient.compat.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  write: false,
  define: createBuildDefines(profile),
  logLevel: "silent",
});

const output = result.outputFiles[0];
if (!output) throw new Error("테스트 번들을 생성하지 못했습니다.");
await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`);
