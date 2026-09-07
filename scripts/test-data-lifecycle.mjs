import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildDefines, loadBuildProfile } from "./build-profile-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/dataLifecycle.browser.ts"], bundle: true,
  platform: "browser", format: "iife", globalName: "regression", write: false,
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', ...createBuildDefines(loadBuildProfile(root, "internal")) }, logLevel: "silent" });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/test.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.end(req.url === "/test.js" ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  console.log(await page.evaluate(() => window.regression.runTests()));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
