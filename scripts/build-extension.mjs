import { build } from "esbuild";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBuildDefines,
  createExtensionCsp,
  loadBuildProfile,
} from "./build-profile-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const backupRootDir = path.join(rootDir, ".dist-build-backups");
const MAX_BUILD_BACKUPS = 3;
const logoFileName = "icon.svg";
const logoSourcePath = path.join(rootDir, logoFileName);

function readProfileIdArgument() {
  const args = process.argv.slice(2);
  if (args.length === 0) return "internal";
  if (args.length === 2 && args[0] === "--profile") return args[1];
  if (args.length === 1 && args[0].startsWith("--profile=")) return args[0].slice("--profile=".length);
  throw new Error("빌드 인자는 --profile internal 또는 --profile external만 허용됩니다.");
}

function isInsideRoot(candidate) {
  const relative = path.relative(rootDir, path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeGeneratedPath(candidate, expectedPrefix) {
  if (!isInsideRoot(candidate) || !path.basename(candidate).startsWith(expectedPrefix)) {
    throw new Error(`안전하지 않은 빌드 경로를 거부했습니다: ${candidate}`);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function toBuildHref(buildDir, outputPath) {
  const absoluteOutput = path.resolve(rootDir, outputPath);
  return `./${path.relative(buildDir, absoluteOutput).replace(/\\/g, "/")}`;
}

function cssHrefsForEntry(buildDir, entryName, cssOutputs) {
  const exactMatch = cssOutputs.find((filePath) => path.basename(filePath) === `${entryName}.css`);
  return (exactMatch ? [exactMatch] : cssOutputs).map((output) => toBuildHref(buildDir, output));
}

async function readHtmlMetadata(sourceHtmlPath, fallbackTitle) {
  const sourceHtml = await readFile(sourceHtmlPath, "utf8");
  const rawLang = sourceHtml.match(/<html[^>]*lang="([^"]+)"/i)?.[1] ?? "ko";
  const title = sourceHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? fallbackTitle;
  return {
    lang: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(rawLang) ? rawLang : "ko",
    title,
  };
}

async function writeBuiltHtml(buildDir, { fileName, title, lang, jsHref, cssHrefs }) {
  const cssLinks = cssHrefs.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`).join("\n    ");
  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="./${logoFileName}" />
    <title>${escapeHtml(title)}</title>
    ${cssLinks}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${escapeHtml(jsHref)}"></script>
  </body>
</html>
`;
  await writeFile(path.join(buildDir, fileName), html, "utf8");
}

async function writeProfileManifest(buildDir, profile) {
  const manifestPath = path.join(buildDir, "manifest.json");
  const manifestSource = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestSource.replace(/^\uFEFF/, ""));
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error("기본 매니페스트의 이름 또는 버전이 올바르지 않습니다.");
  }
  if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length !== 0) {
    throw new Error("기본 매니페스트에는 망별 호스트 권한을 직접 지정할 수 없습니다.");
  }

  manifest.name = `${manifest.name}${profile.extensionNameSuffix}`;
  manifest.version_name = `${manifest.version}-${profile.id}`;
  manifest.host_permissions = [`${profile.origin}/*`];
  manifest.content_security_policy = { extension_pages: createExtensionCsp(profile.origin) };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function validateBuildDirectory(buildDir, profile, excludedProfile) {
  const directoryInfo = await lstat(buildDir);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("빌드 출력 폴더가 실제 디렉터리가 아닙니다.");
  }

  const manifestSource = await readFile(path.join(buildDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource.replace(/^\uFEFF/, ""));
  if (
    JSON.stringify(manifest.permissions) !== JSON.stringify(["storage", "alarms"]) ||
    JSON.stringify(manifest.host_permissions) !== JSON.stringify([`${profile.origin}/*`]) ||
    manifest.content_security_policy?.extension_pages !== createExtensionCsp(profile.origin) ||
    manifest.version_name !== `${manifest.version}-${profile.id}` ||
    !manifest.name.endsWith(profile.extensionNameSuffix)
  ) {
    throw new Error("빌드 매니페스트의 권한 제한이 예상과 다릅니다.");
  }
  const appBundle = await readFile(path.join(buildDir, "assets", "app.js"), "utf8");
  if (!appBundle.includes(profile.chatEndpoint) || !appBundle.includes(profile.modelsEndpoint)) {
    throw new Error("빌드 번들에 선택한 AI Endpoint가 반영되지 않았습니다.");
  }
  if (
    appBundle.includes(excludedProfile.chatEndpoint) ||
    appBundle.includes(excludedProfile.modelsEndpoint)
  ) {
    throw new Error("빌드 번들에 선택하지 않은 망의 AI Endpoint가 포함되었습니다.");
  }
  await Promise.all([
    lstat(path.join(buildDir, "index.html")),
    lstat(path.join(buildDir, "background.js")),
    lstat(path.join(buildDir, "icons", "icon-128.png")),
  ]);
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeGeneratedTree(candidate, expectedPrefix) {
  assertSafeGeneratedPath(candidate, expectedPrefix);
  const generatedName = path.basename(candidate);
  if (
    (expectedPrefix === ".dist-staging-" && !/^\.dist-staging-[A-Za-z0-9]{6}$/.test(generatedName)) ||
    (expectedPrefix === "dist-" && !/^dist-\d{13}-[0-9a-f-]{36}$/.test(generatedName))
  ) {
    throw new Error("자동 생성 규칙과 일치하지 않는 경로는 정리하지 않습니다.");
  }
  if (!(await pathExists(candidate))) return;

  async function removeEntry(entryPath) {
    const relative = path.relative(candidate, entryPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("빌드 정리 경로가 허용 범위를 벗어났습니다.");
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) throw new Error("심볼릭 링크가 포함된 빌드 폴더는 자동 정리하지 않습니다.");
    if (info.isDirectory()) {
      const children = await readdir(entryPath);
      for (const child of children) await removeEntry(path.join(entryPath, child));
      await rmdir(entryPath);
      return;
    }
    if (!info.isFile()) throw new Error("알 수 없는 파일 유형이 포함된 빌드 폴더는 자동 정리하지 않습니다.");
    await unlink(entryPath);
  }

  await removeEntry(candidate);
}

async function pruneBuildArtifacts(backupProfileDir) {
  if (await pathExists(backupProfileDir)) {
    const backupEntries = (await readdir(backupProfileDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^dist-\d{13}-[0-9a-f-]{36}$/.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of backupEntries.slice(MAX_BUILD_BACKUPS)) {
      await removeGeneratedTree(path.join(backupProfileDir, entry.name), "dist-");
    }
  }

  const rootEntries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(".dist-staging-")) {
      await removeGeneratedTree(path.join(rootDir, entry.name), ".dist-staging-");
    }
  }
}

async function promoteBuild(buildDir, distDir, backupProfileDir) {
  assertSafeGeneratedPath(buildDir, ".dist-staging-");
  assertSafeGeneratedPath(distDir, "dist");
  const hasExistingDist = await pathExists(distDir);
  let backupDir;

  if (hasExistingDist) {
    await mkdir(backupProfileDir, { recursive: true });
    backupDir = path.join(backupProfileDir, `dist-${Date.now()}-${randomUUID()}`);
    assertSafeGeneratedPath(backupDir, "dist-");
    await rename(distDir, backupDir);
  }

  try {
    await rename(buildDir, distDir);
  } catch (error) {
    if (backupDir && !(await pathExists(distDir))) await rename(backupDir, distDir);
    throw error;
  }

  if (backupDir) console.info(`이전 빌드는 복구용으로 보존했습니다: ${backupDir}`);
}

async function runBuild() {
  const profile = await loadBuildProfile(rootDir, readProfileIdArgument());
  const excludedProfile = await loadBuildProfile(
    rootDir,
    profile.id === "internal" ? "external" : "internal",
  );
  const distDir = path.join(rootDir, profile.outputDirectoryName);
  const backupProfileDir = path.join(backupRootDir, profile.id);
  await pruneBuildArtifacts(backupProfileDir);
  const buildDir = await mkdtemp(path.join(rootDir, ".dist-staging-"));
  assertSafeGeneratedPath(buildDir, ".dist-staging-");
  try {
    await cp(publicDir, buildDir, { recursive: true, force: false, errorOnExist: true });
    await cp(logoSourcePath, path.join(buildDir, logoFileName), { force: false, errorOnExist: true });
    await writeProfileManifest(buildDir, profile);

    const assetsDir = path.join(buildDir, "assets");
    const buildResult = await build({
    absWorkingDir: rootDir,
    entryPoints: { app: "src/main.tsx" },
    outdir: assetsDir,
    bundle: true,
    platform: "browser",
    format: "esm",
    charset: "utf8",
    target: ["chrome111"],
    conditions: ["browser", "production"],
    define: {
      "process.env.NODE_ENV": '"production"',
      ...createBuildDefines(profile),
    },
    treeShaking: true,
    jsx: "automatic",
    loader: { ".png": "file" },
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    entryNames: "[name]",
    assetNames: "asset-[name]-[hash]",
    metafile: true,
    logLevel: "info",
    write: true,
    });

    const outputs = buildResult.metafile.outputs;
    const appJsOutput = Object.keys(outputs).find((filePath) => outputs[filePath].entryPoint === "src/main.tsx");
    const cssOutputs = Object.keys(outputs).filter((filePath) => filePath.endsWith(".css")).sort();
    if (!appJsOutput) throw new Error("번들 JavaScript 출력을 찾지 못했습니다.");

    const appMeta = await readHtmlMetadata(path.join(rootDir, "index.html"), "플래나이(PLANAI)");
    await writeBuiltHtml(buildDir, {
      fileName: "index.html",
      title: appMeta.title,
      lang: appMeta.lang,
      jsHref: toBuildHref(buildDir, appJsOutput),
      cssHrefs: cssHrefsForEntry(buildDir, "app", cssOutputs),
    });

    await validateBuildDirectory(buildDir, profile, excludedProfile);
    await promoteBuild(buildDir, distDir, backupProfileDir);
    await pruneBuildArtifacts(backupProfileDir);
    console.info(`${profile.label} 빌드 완료: ${distDir}`);
  } catch (error) {
    await removeGeneratedTree(buildDir, ".dist-staging-");
    throw error;
  }
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
