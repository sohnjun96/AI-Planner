import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { skipFirstRunGuide } from "./ui-fixtures.mjs";

// Render actual application elements with synthetic IndexedDB records in a fresh
// browser context. No production profile, network API, or application hooks are used.
// Build dist-web/planai.html first, then: node scripts/test-theme-contrast-ui.mjs
const artifactDirectory = "artifacts/theme-audit-contrast";
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const source = await readFile("src/constants.ts", "utf8");
const presets = [...source.match(/export const COLOR_PRESETS = \[([\s\S]*?)\] as const;/)[1].matchAll(/"(#[0-9a-f]{6})"/gi)].map(match => match[1]);
expect(presets).toHaveLength(20);
const colors = [...presets, "#000000", "#ffffff", "#ffff00", "#010101", "#fefefe"];
const statuses = ["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"];
const now = "2026-10-21T12:00:00+09:00";
const timestamp = new Date(now).toISOString();
const report = {
  fixture: "fresh browser context, synthetic records only, external requests blocked",
  method: "WCAG sRGB relative luminance; CSS foreground alpha and nested ancestor group opacity composited over ancestor backgrounds; gradients sampled at every computed color stop and 15 intermediate points per segment (conservative minimum across all positions). No disabled controls or aria-hidden decoration.",
  excluded: ["display:none/visibility:hidden elements", "disabled controls and aria-hidden decoration", "legacy hidden today-task-card", "TaskItem body and status controls intentionally hidden by the project compact layout; visible archive bodies are evaluated"],
  threshold: 4.5, colors, statuses, checks: [], measurements: [], failures: [], runtimeErrors: [], blockedRemoteRequests: 0,
};

const browser = await chromium.launch({ headless: true });
let context;
let failure;

async function seed(page) {
  await page.evaluate(async ({ colors, statuses, timestamp }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction([...db.objectStoreNames], "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Fixture aborted"));
        for (const store of db.objectStoreNames) if (store !== "settings") transaction.objectStore(store).clear();
        const settings = transaction.objectStore("settings");
        const request = settings.get("default");
        request.onsuccess = () => settings.put({
          ...request.result, id: "default", themeMode: "system", showPastCompleted: true,
          autoBackupEnabled: false, notificationsEnabled: false, weekStartsOn: "mon",
          noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false,
          llmEndpoint: "", llmApiKey: "", llmModel: "synthetic-theme-audit", updatedAt: timestamp,
        });
        colors.forEach((color, index) => {
          const number = String(index).padStart(2, "0");
          const projectId = `contrast-project-${number}`;
          const taskTypeId = `contrast-type-${number}`;
          transaction.objectStore("projects").put({ id: projectId, name: `색상 ${number} ${color}`, color, order: index, isActive: true, createdAt: timestamp, updatedAt: timestamp });
          transaction.objectStore("taskTypes").put({ id: taskTypeId, name: `종류 ${number}`, color, order: index, isDefault: false, isActive: true, createdAt: timestamp, updatedAt: timestamp });
          const putTask = (status, date, suffix) => transaction.objectStore("tasks").put({
            id: `contrast-task-${number}-${status}-${suffix}`, title: `색상 ${number} ${status} ${suffix}`,
            content: `검증 본문 ${number} ${status}`, projectId, taskTypeId, status, isMajor: true,
            startAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
            endAt: new Date(`${date}T10:00:00+09:00`).toISOString(),
            ...(status === "DONE" ? { completedAt: new Date(Date.parse(timestamp) - 3600000).toISOString() } : {}),
            createdAt: timestamp, updatedAt: timestamp,
          });
          statuses.forEach(status => putTask(status, "2026-10-21", "mixed"));
          putTask("DONE", "2026-10-22", "all-done");
        });
      });
    } finally { db.close(); }
    localStorage.setItem("ai-planner:dashboard-view-mode", "MONTH");
  }, { colors, statuses, timestamp });
  await page.reload();
  await expect(page.locator(".dashboard-calendar-card")).toBeVisible();
}

async function navigate(page, route) {
  await page.evaluate(route => { location.hash = `#/${route}`; }, route);
}

// A glyph pixel and an adjacent background pixel are independently composited
// from the element outwards. Applying each ancestor's opacity to the whole group
// preserves the difference between opacity: .6 and a translucent text color.
async function measure(page, scope, name, theme) {
  // Evaluate the resting UI after entrance animations/transitions complete;
  // sampling their transient fade-in opacity is not a text contrast defect.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    }
  });
  const measurements = await page.locator(scope).evaluateAll((roots, options) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const painter = canvas.getContext("2d", { willReadFrequently: true });
    const parse = value => {
      painter.clearRect(0, 0, 1, 1);
      painter.fillStyle = "rgba(0,0,0,0)";
      painter.fillStyle = value;
      painter.fillRect(0, 0, 1, 1);
      return [...painter.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
    };
    const over = (a, b) => {
      const alpha = a[3] + b[3] * (1 - a[3]);
      return alpha === 0 ? [0, 0, 0, 0] : [
        ...a.slice(0, 3).map((v, i) => (v * a[3] + b[i] * b[3] * (1 - a[3])) / alpha), alpha,
      ];
    };
    const opacity = (color, value) => [...color.slice(0, 3), color[3] * value];
    const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => {
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const cache = new Map();
    const layers = element => {
      if (cache.has(element)) return cache.get(element);
      const computed = getComputedStyle(element);
      const background = parse(computed.backgroundColor);
      let samples = [background];
      const image = computed.backgroundImage;
      let unsupported = null;
      if (image !== "none") {
        if (!/^(?:repeating-)?(?:linear|radial)-gradient\(/.test(image)) unsupported = image;
        const colors = [...image.matchAll(/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/g)].map(match => parse(match[0]));
        if (colors.length === 0) unsupported = image;
        else {
          const stops = [...colors];
          for (let index = 1; index < colors.length; index++) {
            const a = colors[index - 1], b = colors[index];
            // CSS gradients interpolate alpha-premultiplied colors. Straight
            // RGBA interpolation invents a dark dip between a translucent tint
            // and white, producing a false failure on the light weekly board.
            for (let step = 1; step < 16; step++) {
              const t = step / 16;
              const alpha = a[3] * (1 - t) + b[3] * t;
              stops.push(alpha === 0 ? [0, 0, 0, 0] : [
                ...a.slice(0, 3).map((v, channel) => (v * a[3] * (1 - t) + b[channel] * b[3] * t) / alpha), alpha,
              ]);
            }
          }
          samples = stops.map(color => over(color, background));
        }
      }
      const data = { samples, opacity: Number(computed.opacity), backgroundImage: image, unsupported };
      cache.set(element, data);
      return data;
    };
    const output = [];
    const seen = new Set();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const element = text.parentElement;
        const value = text.textContent.trim();
        if (!value || seen.has(element) || !element.getBoundingClientRect().width || !element.getBoundingClientRect().height) continue;
        seen.add(element);
        if (element.closest('[aria-hidden="true"], [hidden], button:disabled, input:disabled, select:disabled, textarea:disabled')) continue;
        const ancestors = [];
        let visible = true;
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) visible = false;
          ancestors.push(node);
        }
        if (!visible) continue;
        const foreground = parse(getComputedStyle(element).color);
        let pixels = [{ background: [0, 0, 0, 0], foreground }];
        const details = [];
        for (const ancestor of ancestors) {
          const layer = layers(ancestor);
          if (layer.unsupported) throw new Error(`Unsupported background image: ${layer.unsupported}`);
          if (layer.opacity !== 1 || layer.backgroundImage !== "none") details.push({ element: `${ancestor.tagName.toLowerCase()}.${[...ancestor.classList].join(".")}`, opacity: layer.opacity, backgroundImage: layer.backgroundImage });
          pixels = pixels.flatMap(pixel => layer.samples.map(background => ({
            background: opacity(over(pixel.background, background), layer.opacity),
            foreground: opacity(over(pixel.foreground, background), layer.opacity),
          })));
        }
        let minimum = null;
        for (const pixel of pixels) {
          const foreground = over(pixel.foreground, [255, 255, 255, 1]);
          const background = over(pixel.background, [255, 255, 255, 1]);
          const ratio = contrast(foreground, background);
          if (!minimum || ratio < minimum.ratio) minimum = { ratio, foreground: foreground.slice(0, 3).map(v => Math.round(v * 100) / 100), background: background.slice(0, 3).map(v => Math.round(v * 100) / 100) };
        }
        const card = element.closest(".compact-task-card, .calendar-day-detail-item, .task-item, .archive-task-card");
        output.push({
          scope: options.name, theme: options.theme, text: value,
          element: `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`,
          card: card?.querySelector(".compact-task-title, strong, h4, h3")?.textContent?.trim() ?? null,
          cardClass: card?.className ?? null, ...minimum, compositeLayers: details,
        });
      }
    }
    return output;
  }, { name, theme });
  expect(measurements.length, `${name} must have visible text to evaluate`).toBeGreaterThan(0);
  report.measurements.push(...measurements);
  const failures = measurements.filter(item => item.ratio + 1e-6 < report.threshold);
  report.failures.push(...failures);
  report.checks.push({ theme, name, textElements: measurements.length, minimumContrast: Math.min(...measurements.map(item => item.ratio)), failures: failures.length });
}

async function screenshot(page, name, locator) {
  if (locator) await locator.screenshot({ path: `${artifactDirectory}/${name}.png`, animations: "disabled" });
  else await page.screenshot({ path: `${artifactDirectory}/${name}.png`, animations: "disabled" });
}

try {
  await mkdir(artifactDirectory, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul", colorScheme: "dark" });
  await skipFirstRunGuide(context);
  await context.route(/^https?:/, route => { report.blockedRemoteRequests += 1; return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", error => report.runtimeErrors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${fileUrl}#/dashboard`);
  await expect(page.locator(".dashboard-calendar-card")).toBeVisible();
  await seed(page);

  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await navigate(page, "dashboard");
    const view = page.getByRole("group", { name: "대시보드 일정 보기 방식", exact: true });
    await view.getByRole("button", { name: "월간", exact: true }).click();
    await page.locator('.calendar-day[data-calendar-date="2026-10-21"]').click();
    await expect(page.locator(".calendar-day-detail-item")).toHaveCount(colors.length * statuses.length);
    await measure(page, ".calendar-day-detail-popover", "month-popover-mixed-status", theme);
    await measure(page, ".dashboard-selected-day-card", "selected-day-mixed-status", theme);
    // The legacy today-task-card remains in the DOM with display:none in the
    // current dashboard. Audit the compact schedules actually presented above.
    await measure(page, ".dashboard-calendar-month", "month-calendar-selected", theme);
    await screenshot(page, `${theme}-month-mixed`);
    const sample = page.locator(".calendar-day-detail-item").filter({ hasText: "색상 00 NOT_DONE mixed" });
    await sample.hover();
    await measure(page, ".calendar-day-detail-popover", "month-popover-hover", theme);
    await page.locator('.calendar-day[data-calendar-date="2026-10-22"]').click();
    await expect(page.locator(".calendar-day-detail-item.all-done-day")).toHaveCount(colors.length);
    await measure(page, ".calendar-day-detail-popover", "month-popover-all-done", theme);
    await measure(page, ".dashboard-selected-day-card", "selected-day-all-done", theme);
    await screenshot(page, `${theme}-month-all-done`);

    for (const [label, selector] of [["목록", ".dashboard-list-view"], ["주간", ".dashboard-week-view"]]) {
      await view.getByRole("button", { name: label, exact: true }).click();
      await page.locator(selector).getByRole("group", { name: "상태별 필터", exact: true }).getByRole("button", { name: /^전체 / }).click();
      await expect(page.locator(`${selector} .compact-task-card`)).toHaveCount(colors.length * (statuses.length + 1));
      await measure(page, selector, `${label}-all-colors-all-statuses`, theme);
      const firstCard = page.locator(`${selector} .compact-task-card`).first();
      await firstCard.hover();
      await measure(page, selector, `${label}-hover`, theme);
      await screenshot(page, `${theme}-${label}`);
    }

    // TaskItem is used by project schedules, including its body and both color tags.
    for (let index = 0; index < colors.length; index++) {
      const number = String(index).padStart(2, "0");
      await navigate(page, `projects?projectId=contrast-project-${number}`);
      await page.locator(".overview-stat-button.all").click();
      await expect(page.locator(".task-item")).toHaveCount(statuses.length + 1);
      await measure(page, ".task-item", `project-${number}-${colors[index]}-task-tags`, theme);
      if (index === 0) {
        const title = page.locator(".task-item h4 button").first();
        await title.click();
        await measure(page, ".task-item", "project-opened-task", theme);
        await screenshot(page, `${theme}-project-selected`);
        await page.keyboard.press("Escape");
      }
    }

    await navigate(page, "archive");
    await page.locator(".archive-all-records-toggle").click();
    await expect(page.locator(".archive-list .archive-task-card")).toHaveCount(colors.length * 2);
    await measure(page, ".archive-list", "archive-all-color-tags", theme);
    await screenshot(page, `${theme}-archive`);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await navigate(page, "dashboard");
      await page.getByRole("group", { name: "대시보드 일정 보기 방식", exact: true }).getByRole("button", { name: "월간", exact: true }).click();
      await page.locator('.calendar-day[data-calendar-date="2026-10-21"]').click();
      await measure(page, ".dashboard-calendar-month, .calendar-day-detail-popover, .dashboard-selected-day-card", `mobile-${width}-calendar-and-selected`, theme);
      await screenshot(page, `${theme}-mobile-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(report.runtimeErrors).toEqual([]);
} catch (error) {
  failure = error;
  report.executionError = error.stack ?? error.message;
} finally {
  await context?.close();
  await browser.close();
  report.summary = {
    checks: report.checks.length, textElements: report.measurements.length,
    darkFailures: report.failures.filter(item => item.theme === "dark").length,
    lightFailures: report.failures.filter(item => item.theme === "light").length,
  };
  await writeFile(`${artifactDirectory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, checks: report.checks, executionError: report.executionError, failureExamples: report.failures.slice(0, 8) }, null, 2));
}
if (failure) throw failure;
if (report.failures.length) throw new Error(`${report.failures.length} text contrast failures; see ${artifactDirectory}/report.json`);
