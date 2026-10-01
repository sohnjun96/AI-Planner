import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const browser = await chromium.launch({ headless: true });
const appUrl = process.argv[2] ?? pathToFileURL(path.resolve("dist-web/planai.html")).href;
const outputDirectory = "artifacts/routine-recurrence-ui";
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-10-01T03:00:00Z"));
  await page.route(/^https?:/, (route) => appUrl.startsWith("http") && route.request().url().startsWith(new URL(appUrl).origin) ? route.continue() : route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${appUrl}#/routines`);
  await expect(page.getByRole("heading", { name: "나의 루틴", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "+ 루틴 추가", exact: true });
  const modal = page.locator(".routine-modal");
  const preview = modal.getByRole("complementary", { name: "선택한 반복 규칙 미리보기" });
  const card = (title) => page.locator(".routine-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  async function edit(title) {
    await card(title).getByRole("button", { name: `${title} 더보기`, exact: true }).click();
    await page.getByRole("menuitem", { name: "수정", exact: true }).click();
  }
  async function open(title) {
    await add.click();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("어떤 일을 챙길까요?")).toBeFocused();
    await expect(modal.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
    await expect(preview.locator(".routine-preview-summary")).toContainText(/월요일.*수요일.*금요일/);
    if (title) await modal.getByLabel("어떤 일을 챙길까요?").fill(title);
  }
  async function save(checkDuplicate = false) {
    if (checkDuplicate) await modal.locator("form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    else await modal.getByRole("button", { name: "루틴 등록", exact: true }).click();
    await expect(modal).toHaveCount(0);
  }
  async function expand(name) { await modal.locator("summary").filter({ hasText: name }).click(); }
  await mkdir(outputDirectory, { recursive: true });

  // The empty title does not suppress recurrence preview; modal keyboard and cancel paths preserve state.
  await open();
  await expect(preview.locator(".routine-preview-occurrences li")).toHaveCount(5);
  await modal.getByRole("button", { name: "루틴 등록", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "나의 루틴 추가 창 닫기" })).toBeFocused();
  await modal.getByLabel("어떤 일을 챙길까요?").fill("취소할 초안");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(modal.getByLabel("어떤 일을 챙길까요?")).toHaveValue("취소할 초안");
  page.once("dialog", (dialog) => dialog.accept());
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(card("취소할 초안")).toHaveCount(0);

  await open("주간 운동");
  await modal.getByLabel("반복 간격", { exact: true }).fill("2");
  await expect(preview).toContainText("2주마다");
  await expand("알림과 연결");
  await modal.getByLabel("미리 알림", { exact: true }).selectOption("7");
  await expect(preview).toContainText("이전 예정일보다 빠르거나 같습니다");
  await expect(preview).toContainText("안내일이 지났습니다");
  await modal.getByLabel("미리 알림", { exact: true }).selectOption("custom");
  await modal.getByLabel("며칠 전에 알려드릴까요?").fill("2");
  await expect(preview).toContainText("2일 전 안내");
  await modal.locator(".routine-editor-scroll").evaluate((element) => { element.scrollTop = 0; });
  const desktopInterval = await modal.locator(".routine-interval").evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element.querySelector("span"));
    return { width: element.querySelector("input").getBoundingClientRect().width, unitLines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
  });
  if (desktopInterval.width > 80 || desktopInterval.unitLines !== 1) throw new Error(`Desktop interval layout failed: ${JSON.stringify(desktopInterval)}`);
  await page.screenshot({ path: `${outputDirectory}/desktop-weekly.png` });
  await save(true);
  await expect(card("주간 운동")).toHaveCount(1);
  await card("주간 운동").locator(".routine-details-toggle").click();
  await expect(card("주간 운동")).toContainText("2주마다");
  await page.reload();
  await edit("주간 운동");
  await expect(modal.getByLabel("반복 간격", { exact: true })).toHaveValue("2");
  await expect(modal.getByRole("checkbox", { name: "수요일", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");

  // Missing dates, weekend movement, exclusions and finite counts use the same dates as saved rules.
  await open("월말 정산");
  await modal.getByRole("radio", { name: "매월", exact: true }).check();
  await modal.getByRole("checkbox", { name: "매월 1일", exact: true }).uncheck();
  await modal.getByRole("checkbox", { name: "매월 31일", exact: true }).check();
  await expect(preview.locator('li > time[datetime="2026-11-30"]')).toBeVisible();
  await expect(preview).toContainText("날짜 조정");
  await modal.getByLabel("선택한 날짜가 없는 달은").selectOption("skip");
  await expect(preview.locator('li > time[datetime="2026-11-30"]')).toHaveCount(0);
  await expect(preview.locator('li > time[datetime="2026-12-31"]')).toBeVisible();
  await expand("종료·예외 설정");
  await modal.getByLabel("예정일이 주말이면").selectOption("previous");
  await expect(preview.locator('li > time[datetime="2026-10-30"]')).toBeVisible();
  await modal.getByLabel("제외할 날짜", { exact: true }).fill("2026-10-30");
  await modal.getByRole("button", { name: "제외 날짜 추가", exact: true }).click();
  await expect(preview.locator('li > time[datetime="2026-10-30"]')).toHaveCount(0);
  await modal.getByRole("button", { name: "2026-10-30 제외 해제", exact: true }).click();
  await expect(preview.locator('li > time[datetime="2026-10-30"]')).toBeVisible();
  await modal.getByLabel("반복 종료", { exact: true }).selectOption("count");
  await modal.getByLabel("총 몇 회 반복할까요?").fill("2");
  await expect(preview.locator(".routine-preview-occurrences li")).toHaveCount(2);
  await page.screenshot({ path: `${outputDirectory}/desktop-monthly.png` });
  await save();

  await open("마지막 금요일 점검");
  await modal.getByRole("radio", { name: "매월", exact: true }).check();
  await modal.getByRole("radio", { name: "요일로 지정", exact: true }).check();
  await modal.getByLabel("몇 번째 요일인가요?").selectOption("-1");
  for (const day of ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]) {
    const checkbox = modal.getByRole("checkbox", { name: day, exact: true });
    if (day === "금요일") await checkbox.check(); else await checkbox.uncheck();
  }
  await expect(preview.locator('li > time[datetime="2026-10-30"]')).toBeVisible();
  await expect(preview.locator('li > time[datetime="2026-11-27"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${outputDirectory}/mobile-monthly.png` });
  const mobile = await modal.evaluate((element) => {
    const repeat = element.querySelector(".routine-editor-repeat").getBoundingClientRect();
    const preview = element.querySelector(".routine-rule-preview").getBoundingClientRect();
    const actions = element.querySelector(".routine-editor-actions").getBoundingClientRect();
    const choices = [...element.querySelectorAll(".routine-choice")].map((choice) => choice.getBoundingClientRect().height);
    const interval = element.querySelector(".routine-interval");
    const range = document.createRange(); range.selectNodeContents(interval.querySelector("span"));
    return { overflows: document.documentElement.scrollWidth > innerWidth + 1, previewAfterRule: preview.top >= repeat.bottom - 1, actionsVisible: actions.bottom <= innerHeight + 1, intervalWidth: interval.querySelector("input").getBoundingClientRect().width, unitLines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, choices };
  });
  if (mobile.overflows || !mobile.previewAfterRule || !mobile.actionsVisible || mobile.intervalWidth > 80 || mobile.unitLines !== 1 || mobile.choices.some((height) => height < 43.5)) throw new Error(`Mobile recurrence layout failed: ${JSON.stringify(mobile)}`);
  await page.setViewportSize({ width: 320, height: 740 });
  if (await modal.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) throw new Error("320px modal horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await save();

  await open("반기 확인");
  await modal.getByRole("radio", { name: "매년", exact: true }).check();
  await modal.getByRole("checkbox", { name: "10월", exact: true }).uncheck();
  await modal.getByRole("checkbox", { name: "1월", exact: true }).check();
  await modal.getByRole("checkbox", { name: "7월", exact: true }).check();
  await expect(preview.locator('li > time[datetime="2027-01-01"]')).toBeVisible();
  await expect(preview.locator('li > time[datetime="2027-07-01"]')).toBeVisible();
  await save();

  // A processed occurrence is excluded from edit previews, including a routine that has ended.
  await open("매일 확인");
  await modal.getByRole("radio", { name: "매일", exact: true }).check();
  await expand("알림과 연결");
  await modal.getByLabel("안내 방식", { exact: true }).selectOption("remind");
  await expand("프로젝트·일정 설정");
  await expect(modal.getByLabel("일정 종류", { exact: true })).toHaveCount(0);
  await expect(modal.getByLabel("생성할 일정 시간", { exact: true })).toHaveCount(0);
  await save();
  await card("매일 확인").getByRole("button", { name: "확인했어요", exact: true }).click();
  await edit("매일 확인");
  await expect(preview.locator('li > time[datetime="2026-10-01"]')).toHaveCount(0);
  await expect(preview.locator('li > time[datetime="2026-10-02"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await open("한 번만 확인");
  await modal.getByRole("radio", { name: "매일", exact: true }).check();
  await expand("알림과 연결");
  await modal.getByLabel("안내 방식", { exact: true }).selectOption("remind");
  await expand("종료·예외 설정");
  await modal.getByLabel("반복 종료", { exact: true }).selectOption("date");
  await expect(preview.locator(".routine-preview-occurrences li")).toHaveCount(1);
  await save();
  await card("한 번만 확인").getByRole("button", { name: "확인했어요", exact: true }).click();
  await expect(card("한 번만 확인").getByRole("button", { name: "반복 설정", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "종료", exact: true }).click();
  await expect(card("한 번만 확인")).toBeVisible();
  await expect(card("매일 확인")).toHaveCount(0);
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open("schedule-manager-db"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      const store = transaction.objectStore("projects");
      const request = store.getAll();
      request.onsuccess = () => request.result.forEach((project) => store.put({ ...project, isActive: false }));
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await add.click();
  await expect(preview.locator(".routine-preview-occurrences li")).toHaveCount(5);
  await expect(modal.getByRole("button", { name: "루틴 등록", exact: true })).toBeDisabled();
  await expect(modal).toContainText("활성 프로젝트와 일정 종류가 필요합니다");
  await page.keyboard.press("Escape");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Routine recurrence UI: modal focus/cancel, duplicate submit, weekly, monthly clamp/skip/ordinal, yearly, lead overlap, exclusions/end, processed preview, missing active project and 320/390px layout passed.");
} finally { await browser.close(); }
