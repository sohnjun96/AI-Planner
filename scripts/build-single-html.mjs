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
  if (!/<script type="module">[\s\S]+<\/script>\s*<\/body>/i.test(html)) {
    throw new Error("인라인 애플리케이션 스크립트를 찾지 못했습니다.");
  }
}

async function runBuild() {
  const profile = loadBuildProfile(rootDir, "internal");
  const iconSvg = await readFile(path.join(rootDir, "icon.svg"), "utf8");
  const iconUrl = dataUrl("image/svg+xml", iconSvg);
  const result = await build({
    absWorkingDir: rootDir,
    entryPoints: ["src/main.tsx"],
    outdir: "single-html-build",
    bundle: true,
    platform: "browser",
    format: "esm",
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

  const safeJavascript = escapeInlineScript(javascript);
  const csp = [
    "default-src 'none'",
    `script-src ${sha256Csp(safeJavascript)}`,
    `style-src ${sha256Csp(css)} 'unsafe-inline'`,
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
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${safeJavascript}</script>
  </body>
</html>
`;

  assertSingleFileHtml(html, profile);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, html, "utf8");
  console.info(`단일 HTML 빌드 완료: ${outputPath} (${Buffer.byteLength(html, "utf8")} bytes)`);
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
