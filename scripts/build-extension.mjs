import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");

async function runBuild() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });

  const buildResult = await build({
    absWorkingDir: rootDir,
    entryPoints: ["src/main.tsx"],
    outdir: "dist/assets",
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["chrome107"],
    jsx: "automatic",
    minify: false,
    sourcemap: false,
    entryNames: "app",
    assetNames: "asset-[name]-[hash]",
    metafile: true,
    logLevel: "info",
    write: true,
  });

  const outputEntries = Object.keys(buildResult.metafile.outputs);
  const jsOutput = outputEntries.find(
    (filePath) => filePath.endsWith(".js") && Boolean(buildResult.metafile.outputs[filePath].entryPoint),
  );
  const cssOutput = outputEntries.find((filePath) => filePath.endsWith(".css"));

  if (!jsOutput) {
    throw new Error("Failed to locate bundled JavaScript output.");
  }

  const jsHref = `./${path.relative(distDir, path.resolve(rootDir, jsOutput)).replace(/\\/g, "/")}`;
  const cssHref = cssOutput
    ? `./${path.relative(distDir, path.resolve(rootDir, cssOutput)).replace(/\\/g, "/")}`
    : "";

  const sourceHtmlPath = path.join(rootDir, "index.html");
  const sourceHtml = await readFile(sourceHtmlPath, "utf8");
  const langMatched = sourceHtml.match(/<html[^>]*lang=\"([^\"]+)\"/i);
  const lang = langMatched?.[1] ?? "ko";
  const titleMatched = sourceHtml.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatched?.[1] ?? "업무 일정관리";

  const builtHtml = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${cssHref ? `<link rel="stylesheet" href="${cssHref}" />` : ""}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${jsHref}"></script>
  </body>
</html>
`;

  await writeFile(path.join(distDir, "index.html"), builtHtml, "utf8");
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
