import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const iconSourcePath = path.join(rootDir, "아이콘.png");

function toDistHref(outputPath) {
  return `./${path.relative(distDir, path.resolve(rootDir, outputPath)).replace(/\\/g, "/")}`;
}

function cssHrefsForEntry(entryName, cssOutputs) {
  const exactMatch = cssOutputs.find((filePath) => path.basename(filePath) === `${entryName}.css`);
  return (exactMatch ? [exactMatch] : cssOutputs).map(toDistHref);
}

async function readHtmlMetadata(sourceHtmlPath, fallbackTitle) {
  const sourceHtml = await readFile(sourceHtmlPath, "utf8");
  const langMatched = sourceHtml.match(/<html[^>]*lang="([^"]+)"/i);
  const titleMatched = sourceHtml.match(/<title>([^<]+)<\/title>/i);

  return {
    lang: langMatched?.[1] ?? "ko",
    title: titleMatched?.[1] ?? fallbackTitle,
  };
}

async function writeBuiltHtml({ fileName, title, lang, jsHref, cssHrefs, bodyClass = "" }) {
  const cssLinks = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}" />`).join("\n    ");
  const classAttribute = bodyClass ? ` class="${bodyClass}"` : "";
  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${cssLinks}
  </head>
  <body${classAttribute}>
    <div id="root"></div>
    <script type="module" src="${jsHref}"></script>
  </body>
</html>
`;

  await writeFile(path.join(distDir, fileName), html, "utf8");
}

async function runBuild() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true, force: true });
  await cp(iconSourcePath, path.join(distDir, "아이콘.png"), { force: true });

  const buildResult = await build({
    absWorkingDir: rootDir,
    entryPoints: {
      app: "src/main.tsx",
    },
    outdir: "dist/assets",
    bundle: true,
    platform: "browser",
    format: "esm",
    charset: "utf8",
    target: ["chrome107"],
    jsx: "automatic",
    loader: {
      ".png": "file",
    },
    minify: false,
    sourcemap: false,
    entryNames: "[name]",
    assetNames: "asset-[name]-[hash]",
    metafile: true,
    logLevel: "info",
    write: true,
  });

  const outputs = buildResult.metafile.outputs;
  const appJsOutput = Object.keys(outputs).find((filePath) => outputs[filePath].entryPoint === "src/main.tsx");
  const cssOutputs = Object.keys(outputs)
    .filter((filePath) => filePath.endsWith(".css"))
    .sort();

  if (!appJsOutput) {
    throw new Error("Failed to locate bundled JavaScript outputs.");
  }

  const appMeta = await readHtmlMetadata(path.join(rootDir, "index.html"), "플래나이(PLANAI)");
  await writeBuiltHtml({
    fileName: "index.html",
    title: appMeta.title,
    lang: appMeta.lang,
    jsHref: toDistHref(appJsOutput),
    cssHrefs: cssHrefsForEntry("app", cssOutputs),
  });
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
