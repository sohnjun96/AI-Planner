import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul" });
  await page.clock.setFixedTime(new Date("2026-10-01T03:00:00Z"));
  await page.route(/^https?:/, (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${pathToFileURL(path.resolve("dist-web/planai.html")).href}#/routines`);
  await expect(page.getByRole("heading", { name: "나의 루틴", exact: true })).toBeVisible();
  await expect(page.getByText("등록된 루틴이 없습니다.")).toBeVisible();
  const card = (title) => page.locator(".routine-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  async function collapseReminder() {
    const collapse = page.getByRole("button", { name: "루틴 알림 접기", exact: true });
    if (await collapse.isVisible()) await collapse.click();
  }
  async function setDetailsExpanded(routineCard, expanded) {
    const toggle = routineCard.locator(".routine-details-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== String(expanded)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
  }
  async function openMenu(title) {
    await card(title).getByRole("button", { name: `${title} 더보기`, exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  }
  async function addRoutine(title, mode = "schedule", { memo = "", endsAfter } = {}) {
    await page.getByRole("button", { name: "+ 루틴 추가", exact: true }).click();
    await page.getByLabel("루틴 이름").fill(title);
    await page.getByRole("radio", { name: "매월", exact: true }).check();
    await page.locator(".routine-editor-details summary").filter({ hasText: "알림 설정" }).click();
    await page.getByLabel("미리 알림").selectOption("0");
    await page.getByLabel("안내 방식").selectOption(mode);
    if (memo) {
      await page.locator(".routine-editor-details summary").filter({ hasText: "메모" }).click();
      await page.getByLabel("메모", { exact: true }).fill(memo);
    }
    if (endsAfter) {
      await page.locator(".routine-editor-details summary").filter({ hasText: "종료·예외 설정" }).click();
      await page.getByLabel("반복 종료", { exact: true }).selectOption("count");
      await page.getByLabel("반복 횟수").fill(String(endsAfter));
    }
    await page.getByRole("button", { name: "루틴 등록", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card(title)).toBeVisible();
    await collapseReminder();
  }
  const memo = "영수증과 거래명세서를 함께 확인해 주세요.";
  await addRoutine("영수증 취합", "schedule", { memo });
  await addRoutine("장비 점검", "remind");
  await mkdir("artifacts/routines", { recursive: true });
  await page.screenshot({ path: "artifacts/routines/desktop.png", fullPage: true });
  const receipt = card("영수증 취합");
  // Secondary information stays collapsed until requested, including with a keyboard.
  await expect(receipt.locator(".routine-details-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(receipt.getByText(memo, { exact: true })).not.toBeVisible();
  await receipt.locator(".routine-details-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(receipt.locator(".routine-details-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(receipt.getByText(memo, { exact: true })).toBeVisible();
  await setDetailsExpanded(receipt, false);
  // Management actions are discoverable in a menu; Escape returns to its trigger.
  const receiptMore = receipt.getByRole("button", { name: "영수증 취합 더보기", exact: true });
  await receiptMore.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  for (const name of ["수정", "일시 중지", "이번 회차 건너뛰기", "삭제"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(receiptMore).toBeFocused();
  await receipt.getByRole("button", { name: "일정 만들기", exact: true }).click();
  await expect(page.locator('input[name="title"]')).toHaveValue("영수증 취합");
  await page.getByRole("button", { name: "루틴에서 일정 만들기 창 닫기" }).click();
  await expect(receipt.getByRole("button", { name: "일정 만들기", exact: true })).toBeVisible();
  await expect(page.locator(".routine-list-group-title").filter({ hasText: "확인 필요" })).toBeVisible();
  await receipt.getByRole("button", { name: "일정 만들기", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await collapseReminder();
  await setDetailsExpanded(receipt, true);
  await expect(receipt.getByText(memo, { exact: true })).toBeVisible();
  await expect(receipt.getByRole("button", { name: "일정 보기" })).toBeVisible();
  await expect(receipt.getByRole("button", { name: "일정 만들기", exact: true })).toHaveCount(0);
  await setDetailsExpanded(receipt, false);
  await expect(receipt.getByRole("button", { name: "일정 보기" })).not.toBeVisible();
  const equipment = card("장비 점검");
  await equipment.getByRole("button", { name: "나중에", exact: true }).click();
  await page.getByRole("button", { name: "3일 뒤", exact: true }).click();
  await page.getByRole("button", { name: "이날 다시 알려주세요" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(equipment.getByRole("button", { name: "확인했어요" })).toHaveCount(0);
  await openMenu("장비 점검");
  await page.getByRole("menuitem", { name: "일시 중지", exact: true }).click();
  await expect(equipment.getByRole("button", { name: "다시 시작" })).toBeVisible();
  await page.reload();
  await expect(equipment.getByRole("button", { name: "다시 시작" })).toBeVisible();
  await equipment.getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(equipment.getByRole("button", { name: "다시 시작" })).toHaveCount(0);
  await expect(equipment.locator(".routine-details-toggle")).toBeFocused();
  await expect(equipment.getByRole("button", { name: "확인했어요" })).toHaveCount(0);
  // A finite reminder can be acknowledged and its ended card offers the next useful action.
  await addRoutine("마지막 확인", "remind", { endsAfter: 1 });
  const completed = card("마지막 확인");
  await completed.getByRole("button", { name: "확인했어요", exact: true }).click();
  await expect(completed.getByRole("button", { name: "반복 설정", exact: true })).toBeVisible();
  await expect(completed.locator(".routine-details-toggle")).toBeFocused();
  await setDetailsExpanded(completed, true);
  await expect(completed.locator(".routine-history li")).toContainText("· 확인");
  await completed.getByRole("button", { name: "반복 설정", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "루틴 수정" })).toBeVisible();
  await expect(page.getByLabel("루틴 이름")).toHaveValue("마지막 확인");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addRoutine("정기 보고서");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await setDetailsExpanded(receipt, true);
    await expect(receipt.getByText(memo, { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error(`Mobile horizontal overflow at ${width}px`);
    await openMenu("영수증 취합");
    await expect.poll(async () => page.getByRole("menu").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
    })).toBe(true);
    await page.keyboard.press("Escape");
    await expect(receiptMore).toBeFocused();
    await page.screenshot({ path: `artifacts/routines/mobile-${width}.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "대시보드", exact: true }).click();
  await expect(page.getByRole("region", { name: "확인할 나의 루틴" })).toBeVisible();
  await openMenu("정기 보고서");
  await page.getByRole("menuitem", { name: "이번 회차 건너뛰기", exact: true }).click();
  await expect(page.getByRole("region", { name: "확인할 나의 루틴" })).toHaveCount(0);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Routine UI: registration, compact details, keyboard menu/focus, draft cancel/save, history, snooze, pause/resume, finite reminder, dashboard skip and 320/390px layouts passed.");
} finally { await browser.close(); }
