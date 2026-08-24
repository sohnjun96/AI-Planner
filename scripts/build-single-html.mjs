import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildDefines, loadBuildProfile } from "./build-profile-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const outputDir = path.join(rootDir, "dist-web");
const outputPath = path.join(outputDir, "planai.html");
const MAX_SINGLE_HTML_BYTES = 5 * 1024 * 1024;
const VERIFY_ONLY_ARGUMENT = "--verify-only";

function sha256Csp(value) {
  return `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;
}

function escapeInlineScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
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

function normalizeInlineText(value) {
  return value.replace(/\r\n?/g, "\n");
}

function dataUrl(mimeType, contents) {
  return `data:${mimeType};base64,${Buffer.from(contents).toString("base64")}`;
}

function assertSingleFileHtml(html, profile) {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_SINGLE_HTML_BYTES) {
    throw new Error(`단일 HTML 크기가 제한(${MAX_SINGLE_HTML_BYTES}바이트)을 초과했습니다: ${bytes}`);
  }
  if (!html.includes(profile.chatEndpoint) || profile.modelsEndpoints.some((endpoint) => !html.includes(endpoint))) {
    throw new Error("단일 HTML에 내부망 AI Endpoint가 정확히 반영되지 않았습니다.");
  }
  if (/<(?:script|link)\b[^>]+(?:src|href)\s*=\s*["'](?!data:)/i.test(html)) {
    throw new Error("단일 HTML에 외부 JavaScript, CSS 또는 아이콘 참조가 남아 있습니다.");
  }
  const scriptMatch = html.match(/<script>([\s\S]+)<\/script>\s*<\/body>/i);
  if (!scriptMatch) {
    throw new Error("인라인 애플리케이션 스크립트를 찾지 못했습니다.");
  }
  if (/<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html)) {
    throw new Error("단일 HTML은 file:// 직접 실행을 위해 모듈 스크립트를 사용할 수 없습니다.");
  }
  const styleMatch = html.match(/<style>([\s\S]+)<\/style>/i);
  if (!styleMatch) {
    throw new Error("인라인 애플리케이션 스타일을 찾지 못했습니다.");
  }

  // HTML 파서는 CRLF를 LF로 정규화한 뒤 CSP 해시를 비교한다. 실제 브라우저가
  // 검사하는 내용과 같은 값을 다시 계산해, 생성 후 문자열 치환이나 손상으로
  // 애플리케이션 전체가 차단되는 배포 파일을 즉시 거부한다.
  const scriptDirective = escapeHtml(`script-src ${sha256Csp(normalizeInlineText(scriptMatch[1]))}`);
  const styleDirective = escapeHtml(`style-src ${sha256Csp(normalizeInlineText(styleMatch[1]))}`);
  if (!html.includes(scriptDirective)) {
    throw new Error("단일 HTML의 JavaScript와 CSP 해시가 일치하지 않습니다. 생성 후 파일을 수정하지 마세요.");
  }
  if (!html.includes(styleDirective)) {
    throw new Error("단일 HTML의 CSS와 CSP 해시가 일치하지 않습니다. 생성 후 파일을 수정하지 마세요.");
  }
}

function readRunMode() {
  const args = process.argv.slice(2);
  if (args.length === 0) return "build";
  if (args.length === 1 && args[0] === VERIFY_ONLY_ARGUMENT) return "verify";
  throw new Error(`지원하지 않는 인자입니다. 검증만 하려면 ${VERIFY_ONLY_ARGUMENT}를 사용하세요.`);
}

async function verifyExistingBuild(profile) {
  const html = await readFile(outputPath, "utf8");
  assertSingleFileHtml(html, profile);
  console.info(`단일 HTML 무결성 검증 완료: ${outputPath} (${Buffer.byteLength(html, "utf8")} bytes)`);
}

async function runBuild() {
  const profile = loadBuildProfile(rootDir, "internal");
  if (readRunMode() === "verify") {
    await verifyExistingBuild(profile);
    return;
  }
  const iconSvg = await readFile(path.join(rootDir, "icon.svg"), "utf8");
  const iconUrl = dataUrl("image/svg+xml", iconSvg);
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ["src/main.tsx"],
    outdir: "single-html-build",
    bundle: true,
    platform: "browser",
    // file:// 문서에서는 브라우저별 ES module 보안 제약이 달라질 수 있다.
    // 완전히 번들된 IIFE를 고전 스크립트로 실행해 단일 파일 직접 실행을 보장한다.
    format: "iife",
    // ASCII 출력은 JavaScript 문자열의 HTML 비문자(U+FFFF 등)를 이스케이프해
    // 단일 문서를 브라우저뿐 아니라 HTML 검사기와 정적 서버에서도 안전하게 다룬다.
    charset: "ascii",
    target: ["chrome111"],
    conditions: ["browser", "production"],
    define: {
      "process.env.NODE_ENV": '"production"',
      ...createBuildDefines(profile),
      __PLANAI_APP_ICON_URL__: JSON.stringify(iconUrl),
    },
    treeShaking: true,
    jsx: "automatic",
    loader: { ".png": "dataurl", ".svg": "dataurl" },
    minify: true,
    sourcemap: false,
    legalComments: "none",
    write: false,
  });

  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!javascript || !css) throw new Error("인라인으로 변환할 JavaScript 또는 CSS 출력을 찾지 못했습니다.");
  if (/<\/style/i.test(css)) throw new Error("CSS에 안전하게 인라인할 수 없는 종료 태그가 포함되어 있습니다.");

  const safeJavascript = escapeInlineScript(normalizeInlineText(javascript));
  const safeCss = normalizeInlineText(css);
  const csp = [
    "default-src 'none'",
    `script-src ${sha256Csp(safeJavascript)}`,
    `style-src ${sha256Csp(safeCss)} 'unsafe-inline'`,
    `connect-src 'self' ${profile.origin}`,
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
    <meta name="referrer" content="no-referrer" />
    <link rel="icon" type="image/svg+xml" href="${iconUrl}" />
    <title>플래나이(PLANAI)</title>
    <style>${safeCss}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${safeJavascript}</script>
  </body>
</html>
`;

  assertSingleFileHtml(html, profile);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, html, "utf8");
  const persistedHtml = await readFile(outputPath, "utf8");
  assertSingleFileHtml(persistedHtml, profile);
  console.info(`단일 HTML 빌드 완료: ${outputPath} (${Buffer.byteLength(persistedHtml, "utf8")} bytes)`);
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
