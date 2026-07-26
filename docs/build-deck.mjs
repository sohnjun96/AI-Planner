// 플래나이(PLANAI) 소개 슬라이드 생성기
//   node docs/build-deck.mjs
import pptxgen from "pptxgenjs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import sharp from "sharp";
import {
  FaRegStickyNote, FaHourglassHalf, FaSearch, FaFolderOpen,
  FaLink, FaLightbulb, FaLock, FaCheck, FaCommentDots, FaMagic,
} from "react-icons/fa";
import { fileURLToPath } from "node:url";
import path from "node:path";

const Fa = {
  FaRegStickyNote, FaHourglassHalf, FaSearch, FaFolderOpen,
  FaLink, FaLightbulb, FaLock, FaCheck, FaCommentDots, FaMagic,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = (name) => path.join(__dirname, "images", name);

// ---- 팔레트 (앱 정체성: 딥 네이비 + 코발트 블루 + 페이퍼) ----
const INK = "111726";       // 다크 배경
const INK2 = "1B2334";      // 다크 카드
const BLUE = "2563EB";      // 주 강조 (앱 primary)
const BLUE_DK = "1D4ED8";
const SKY = "E8F0FE";       // 옅은 파랑 카드
const SKY2 = "F5F8FF";      // 아주 옅은 배경
const PAPER = "FFFFFF";
const INKTEXT = "1F2637";   // 본문
const MUTED = "6B7280";     // 보조
const ICE = "C7D4EC";       // 다크 위 보조 텍스트
const AMBER = "F59E0B";     // 축하/포인트
const MINT = "10B981";

const HEAD = "Malgun Gothic";
const BODY = "Malgun Gothic";

const softShadow = () => ({ type: "outer", color: "111726", blur: 12, offset: 4, angle: 90, opacity: 0.1 });
const noteShadow = () => ({ type: "outer", color: "111726", blur: 8, offset: 3, angle: 90, opacity: 0.16 });

const pres = new pptxgen();
pres.defineLayout({ name: "W", width: 13.33, height: 7.5 });
pres.layout = "W";
pres.author = "플래나이(PLANAI)";
pres.title = "플래나이(PLANAI) 소개";

async function iconPng(Icon, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Icon, { color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function badge(slide, x, y, d, iconData, fill = BLUE) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill } });
  const pad = d * 0.26;
  slide.addImage({ data: iconData, x: x + pad, y: y + pad, w: d - pad * 2, h: d - pad * 2 });
}

function shot(slide, img, ratio, x, y, h) {
  const w = h * ratio;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12,
    fill: { color: PAPER }, line: { color: "DDE5F2", width: 1 }, rectRadius: 0.09, shadow: softShadow(),
  });
  slide.addImage({ path: img, x, y, w, h });
  return w;
}

function eyebrow(slide, text, x, y, color = BLUE) {
  slide.addText(text, { x, y, w: 6, h: 0.3, fontFace: HEAD, fontSize: 11, bold: true, color, charSpacing: 3, margin: 0 });
}

/** 흩어진 쪽지 한 장 */
function stickyNote(slide, { x, y, w, h, rotate, fill, lines, label }) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rotate, fill: { color: fill }, rectRadius: 0.05, shadow: noteShadow(),
  });
  if (label) {
    slide.addText(label, {
      x, y, w, h, rotate, align: "center", valign: "middle",
      fontFace: BODY, fontSize: 10.5, color: "44506A", bold: true, margin: 0,
    });
  } else if (lines) {
    // 글씨 대신 줄무늬로 "적힌 쪽지" 느낌만 준다
    for (let i = 0; i < lines; i += 1) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: x + w * 0.16, y: y + h * (0.28 + i * 0.2), w: w * (i === lines - 1 ? 0.42 : 0.68), h: 0.045,
        rotate, fill: { color: "9AA8C4" },
      });
    }
  }
}

const R144 = 1440 / 1000;    // 가로 스크린샷
const R_SCHED = 664 / 776;   // AI 일정 추가 (세로)
const R_QA = 664 / 553;
const R_CEL = 740 / 175;     // 축하 배너 (타이트 크롭)
const R_CONN = 835 / 219;    // 노트 연결

const ic = {};

async function main() {
  ic.note = await iconPng(Fa.FaRegStickyNote, "#FFFFFF");
  ic.clock = await iconPng(Fa.FaHourglassHalf, "#FFFFFF");
  ic.search = await iconPng(Fa.FaSearch, "#FFFFFF");
  ic.folder = await iconPng(Fa.FaFolderOpen, "#FFFFFF");
  ic.link = await iconPng(Fa.FaLink, "#FFFFFF");
  ic.bulb = await iconPng(Fa.FaLightbulb, "#FFFFFF");
  ic.lock = await iconPng(Fa.FaLock, "#FFFFFF");
  ic.magic = await iconPng(Fa.FaMagic, "#FFFFFF");
  ic.check = await iconPng(Fa.FaCheck, "#2563EB");
  ic.checkMint = await iconPng(Fa.FaCheck, "#10B981");
  ic.chat = await iconPng(Fa.FaCommentDots, "#10B981");

  // ============ 1. 타이틀 — 쏟아지는 쪽지 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: 8.2, y: -2.6, w: 9, h: 9, fill: { color: BLUE, transparency: 84 } });

    // 오른쪽 위에서 쏟아져 내리는 쪽지들
    const notes = [
      { x: 7.9, y: 0.15, w: 1.5, h: 1.1, rotate: -13, fill: "FFF3C4", lines: 3 },
      { x: 9.5, y: -0.15, w: 1.35, h: 1.0, rotate: 9, fill: "FFFFFF", lines: 3 },
      { x: 11.0, y: 0.35, w: 1.5, h: 1.1, rotate: -6, fill: "DCEBFF", lines: 2 },
      { x: 8.5, y: 1.55, w: 1.4, h: 1.05, rotate: 14, fill: "FFFFFF", lines: 3 },
      { x: 10.2, y: 1.35, w: 1.55, h: 1.15, rotate: -10, fill: "FFE7D6", lines: 3 },
      { x: 11.75, y: 2.0, w: 1.3, h: 0.95, rotate: 7, fill: "FFFFFF", lines: 2 },
      { x: 7.75, y: 3.05, w: 1.45, h: 1.05, rotate: -8, fill: "DCEBFF", lines: 3 },
      { x: 9.35, y: 2.95, w: 1.5, h: 1.1, rotate: 12, fill: "FFF3C4", lines: 2 },
      { x: 11.0, y: 3.5, w: 1.4, h: 1.0, rotate: -14, fill: "FFFFFF", lines: 3 },
      { x: 8.6, y: 4.5, w: 1.35, h: 1.0, rotate: 6, fill: "FFE7D6", lines: 2 },
      { x: 10.3, y: 4.8, w: 1.5, h: 1.1, rotate: -9, fill: "FFFFFF", lines: 3 },
      { x: 11.9, y: 5.3, w: 1.25, h: 0.95, rotate: 15, fill: "DCEBFF", lines: 2 },
    ];
    notes.forEach((n) => stickyNote(s, n));

    // 앱 마크
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.0, y: 1.5, w: 0.86, h: 0.86, fill: { color: BLUE }, rectRadius: 0.16 });
    s.addText("AI", { x: 1.0, y: 1.5, w: 0.86, h: 0.86, align: "center", valign: "middle", fontFace: HEAD, bold: true, fontSize: 22, color: "FFFFFF", margin: 0 });

    s.addText("플래나이", { x: 0.95, y: 2.7, w: 7, h: 1.3, fontFace: HEAD, bold: true, fontSize: 62, color: "FFFFFF", margin: 0 });
    s.addText("PLANAI", { x: 1.02, y: 3.95, w: 7, h: 0.45, fontFace: BODY, fontSize: 15, color: "7E93BE", bold: true, charSpacing: 6, margin: 0 });
    s.addText("쏟아지는 쪽지를, 흐름으로", { x: 1.0, y: 4.55, w: 7.2, h: 0.7, fontFace: HEAD, fontSize: 27, color: "8FB4FF", bold: true, margin: 0 });
    s.addText("마감·제출·취합 일정과 업무 메모를 한곳에 모으고,\nAI가 정리·검색·브리핑을 돕는 로컬 우선 업무 플래너.",
      { x: 1.0, y: 5.35, w: 6.6, h: 1.0, fontFace: BODY, fontSize: 14.5, color: ICE, margin: 0, lineSpacingMultiple: 1.35 });
    s.addNotes("플래나이(PLANAI). 쪽지로 쏟아지는 업무를 한곳에 모아 흐름으로 바꾸는 로컬 우선 플래너.");
  }

  // ============ 2. 쪽지는 계속 쏟아진다 (문제) ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "WHY", 0.9, 0.72);
    s.addText("쪽지는 계속 쏟아지는데,", { x: 0.9, y: 1.0, w: 8.5, h: 0.72, fontFace: HEAD, bold: true, fontSize: 33, color: INKTEXT, margin: 0 });
    s.addText("정리할 시간은 없다", { x: 0.9, y: 1.68, w: 8.5, h: 0.72, fontFace: HEAD, bold: true, fontSize: 33, color: BLUE, margin: 0 });

    const rows = [
      [ic.note, "쪽지가 여기저기 흩어진다", "회의 메모, 취합 요청, 제출 목록이 앱마다 따로 논다."],
      [ic.clock, "마감이 코앞인데 안 보인다", "무엇부터 급한지 한눈에 들어오지 않는다."],
      [ic.folder, "분류할 엄두가 안 난다", "쌓아두기만 하다 결국 어디에 뒀는지 잊는다."],
      [ic.search, "\"그거 어디 적었더라\"", "필요할 때마다 메모를 뒤지느라 시간을 쓴다."],
    ];
    let y = 2.7;
    for (const [icon, title, desc] of rows) {
      badge(s, 0.9, y, 0.6, icon);
      s.addText(title, { x: 1.72, y: y - 0.04, w: 5.6, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16.5, color: INKTEXT, margin: 0 });
      s.addText(desc, { x: 1.72, y: y + 0.34, w: 5.9, h: 0.42, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0 });
      y += 1.05;
    }

    // 오른쪽: 흩어진 쪽지 더미
    const pile = [
      { x: 8.5, y: 1.5, w: 1.5, h: 1.1, rotate: -12, fill: "FFF3C4", label: "제출 마감" },
      { x: 10.3, y: 1.25, w: 1.5, h: 1.1, rotate: 8, fill: "DCEBFF", label: "회의 메모" },
      { x: 9.4, y: 2.65, w: 1.6, h: 1.15, rotate: -5, fill: "FFE7D6", label: "취합 요청" },
      { x: 8.2, y: 3.9, w: 1.5, h: 1.1, rotate: 11, fill: "DCEBFF", label: "교육 이수" },
      { x: 10.6, y: 3.95, w: 1.55, h: 1.15, rotate: -9, fill: "FFF3C4", label: "실적 보고" },
      { x: 9.6, y: 5.2, w: 1.5, h: 1.1, rotate: 5, fill: "FFFFFF", label: "선행조사" },
    ];
    pile.forEach((n) => stickyNote(s, n));
    s.addNotes("대상 사용자의 통증 4가지. 오른쪽은 흩어진 쪽지 더미로 시각화.");
  }

  // ============ 3. 해법 — 3단계 흐름 ============
  {
    const s = pres.addSlide();
    s.background = { color: SKY2 };
    eyebrow(s, "HOW", 0.9, 0.72);
    s.addText("적기만 하면, 나머지는 알아서", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });

    const steps = [
      ["1", "쏟아 넣는다", "쪽지를 그대로 붙여 넣거나\n한 줄로 말하면 됩니다.", ic.note],
      ["2", "알아서 묶인다", "프로젝트·세부 항목으로\n자동 분류되고 제목까지 붙습니다.", ic.magic],
      ["3", "흐름이 보인다", "달력에 마감이 서고,\n관련 노트와 일정이 이어집니다.", ic.link],
    ];
    const cw = 3.7, gap = 0.5;
    let x = 0.9;
    for (const [n, title, desc, icon] of steps) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.25, w: cw, h: 2.9, fill: { color: PAPER }, rectRadius: 0.12, shadow: softShadow() });
      badge(s, x + 0.4, 2.62, 0.62, icon);
      s.addText(n, { x: x + cw - 0.95, y: 2.55, w: 0.7, h: 0.6, align: "right", fontFace: HEAD, bold: true, fontSize: 34, color: "D6E2F7", margin: 0 });
      s.addText(title, { x: x + 0.4, y: 3.45, w: cw - 0.8, h: 0.45, fontFace: HEAD, bold: true, fontSize: 19, color: INKTEXT, margin: 0 });
      s.addText(desc, { x: x + 0.4, y: 3.95, w: cw - 0.75, h: 1.0, fontFace: BODY, fontSize: 13, color: MUTED, margin: 0, lineSpacingMultiple: 1.3 });
      x += cw + gap;
    }

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 5.5, w: 11.53, h: 0.95, fill: { color: SKY }, rectRadius: 0.1 });
    s.addText([
      { text: "AI는 바로 저장하지 않습니다. ", options: { color: INKTEXT, bold: true } },
      { text: "초안을 먼저 보여 주고, 확인한 것만 반영합니다.", options: { color: "3B4A63" } },
    ], { x: 1.25, y: 5.5, w: 10.9, h: 0.95, fontFace: BODY, fontSize: 14, valign: "middle", margin: 0 });
    s.addNotes("쏟아 넣기 → 자동 분류 → 흐름으로. AI는 초안을 먼저 제시하고 확인 후 반영.");
  }

  // ============ 4. 한 줄이면 일정이 된다 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "빠른 입력", 0.9, 0.72);
    s.addText("한 줄이면, 일정이 된다", { x: 0.9, y: 1.0, w: 7.5, h: 0.8, fontFace: HEAD, bold: true, fontSize: 31, color: INKTEXT, margin: 0 });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 2.1, w: 6.3, h: 0.72, fill: { color: PAPER }, line: { color: BLUE, width: 1.25 }, rectRadius: 0.1, shadow: softShadow() });
    s.addText([
      { text: "“", options: { color: BLUE, bold: true } },
      { text: "다음주 금요일까지 교육 이수 후 실적 제출", options: { color: INKTEXT, bold: true } },
      { text: "”", options: { color: BLUE, bold: true } },
    ], { x: 1.15, y: 2.1, w: 5.9, h: 0.72, fontFace: HEAD, fontSize: 16, valign: "middle", margin: 0 });

    const points = [
      ["날짜·시간·종류까지", "마감 표현을 읽어 실제 일정으로 바꿉니다."],
      ["확인 후 반영", "초안 카드에서 원하는 항목만 골라 넣습니다."],
      ["반복은 규칙으로", "\"제출은 오후 6시\" 같은 기준을 기억해 다음부터 자동 적용합니다."],
    ];
    let y = 3.2;
    for (const [t, d] of points) {
      badge(s, 0.9, y + 0.02, 0.34, ic.check, SKY);
      s.addText(t, { x: 1.38, y: y - 0.06, w: 5.6, h: 0.4, fontFace: HEAD, bold: true, fontSize: 15.5, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 1.38, y: y + 0.32, w: 5.8, h: 0.72, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.15;
    }

    shot(s, IMG("ai-schedule.png"), R_SCHED, 7.85, 0.62, 6.3);
    s.addNotes("자연어 한 줄 → 초안 카드. 반복 기준은 user.md 규칙으로 저장되어 자동 적용.");
  }

  // ============ 5. 자동 분류 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "자동 분류", 0.9, 0.72);
    s.addText("던져두면, 알아서 제자리로", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });

    // 왼쪽: 쪽지 → 화살표 → 프로젝트 서랍
    const raw = [
      { x: 0.95, y: 2.2, w: 1.45, h: 1.05, rotate: -10, fill: "FFF3C4", label: "선행문헌\n대조표" },
      { x: 0.95, y: 3.45, w: 1.45, h: 1.05, rotate: 7, fill: "DCEBFF", label: "협의 안건" },
      { x: 0.95, y: 4.7, w: 1.45, h: 1.05, rotate: -5, fill: "FFE7D6", label: "실적 집계" },
    ];
    raw.forEach((n) => stickyNote(s, n));

    s.addText("→", { x: 2.55, y: 3.55, w: 0.7, h: 0.8, align: "center", valign: "middle", fontFace: HEAD, fontSize: 30, color: "9CB6E8", margin: 0 });

    const buckets = [
      ["선행기술조사", "8B5CF6"],
      ["특허심사 AI", "0EA5E9"],
      ["보고", "F59E0B"],
    ];
    let by = 2.2;
    for (const [name, color] of buckets) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.35, y: by, w: 2.5, h: 1.05, fill: { color: SKY2 }, line: { color: "DDE5F2", width: 1 }, rectRadius: 0.08 });
      s.addShape(pres.shapes.OVAL, { x: 3.6, y: by + 0.42, w: 0.2, h: 0.2, fill: { color } });
      s.addText(name, { x: 3.9, y: by, w: 1.8, h: 1.05, valign: "middle", fontFace: HEAD, bold: true, fontSize: 14, color: INKTEXT, margin: 0 });
      by += 1.25;
    }

    const items = [
      ["프로젝트·세부 항목 자동 배정", "새 노트를 백그라운드에서 읽고 알맞은 자리에 넣습니다."],
      ["제목도 알아서", "내용만 적으면 AI가 짧은 제목을 붙입니다."],
      ["직접 고치면 그때부터 고정", "손댄 분류와 제목은 자동 변경 대상에서 빠집니다."],
    ];
    let y = 2.35;
    for (const [t, d] of items) {
      badge(s, 6.5, y + 0.02, 0.34, ic.check, SKY);
      s.addText(t, { x: 6.98, y: y - 0.06, w: 5.6, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 6.98, y: y + 0.34, w: 5.75, h: 0.8, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.25 });
      y += 1.25;
    }

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.5, y: 6.05, w: 6.25, h: 0.75, fill: { color: SKY }, rectRadius: 0.1 });
    s.addText("분류하느라 쓰던 시간을 그대로 돌려받습니다.", { x: 6.8, y: 6.05, w: 5.7, h: 0.75, fontFace: BODY, fontSize: 13, bold: true, color: "1E3A8A", valign: "middle", margin: 0 });
    s.addNotes("노트를 넣기만 하면 프로젝트·세부 항목으로 자동 분류되고 제목도 자동 생성. 직접 고치면 고정.");
  }

  // ============ 6. 연결 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "연결", 0.9, 0.72);
    s.addText("따로 적은 것들이, 서로를 찾는다", { x: 0.9, y: 1.0, w: 9.5, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });

    shot(s, IMG("note-connections.png"), R_CONN, 0.9, 2.15, 1.45);

    // 오른쪽: 노트끼리 관련 제안을 형상화 (스크린샷에는 관련 노트가 비어 있어 보완)
    const relX = 7.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: relX, y: 2.09, w: 5.08, h: 1.57, fill: { color: SKY2 }, line: { color: "DDE5F2", width: 1 }, rectRadius: 0.09 });
    s.addText("관련 노트", { x: relX + 0.25, y: 2.2, w: 2.4, h: 0.3, fontFace: BODY, fontSize: 10.5, bold: true, color: MUTED, margin: 0 });
    const relNotes = [
      ["선행기술조사 정리", "지금 보는 노트"],
      ["심사관 협의 준비 메모", "같은 맥락 · 제안"],
    ];
    let rx = relX + 0.25;
    for (const [title, sub] of relNotes) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rx, y: 2.6, w: 2.25, h: 0.82, fill: { color: PAPER }, line: { color: "DDE5F2", width: 1 }, rectRadius: 0.07 });
      s.addText(title, { x: rx + 0.15, y: 2.7, w: 1.95, h: 0.3, fontFace: HEAD, bold: true, fontSize: 11, color: INKTEXT, margin: 0 });
      s.addText(sub, { x: rx + 0.15, y: 3.0, w: 1.95, h: 0.28, fontFace: BODY, fontSize: 9.5, color: MUTED, margin: 0 });
      rx += 2.33;
    }
    // 두 노트를 잇는 표시
    s.addShape(pres.shapes.OVAL, { x: relX + 2.4, y: 2.9, w: 0.24, h: 0.24, fill: { color: BLUE } });
    s.addText("↔", { x: relX + 2.4, y: 2.88, w: 0.24, h: 0.24, align: "center", valign: "middle", fontFace: BODY, fontSize: 10, bold: true, color: "FFFFFF", margin: 0 });

    const pairs = [
      [ic.link, "노트 ↔ 일정", "노트를 일정에 연결하면 양쪽에서 서로를 오갑니다. 관련 있어 보이는 일정은 먼저 추천해 줍니다."],
      [ic.bulb, "노트 ↔ 노트", "같은 맥락의 노트를 찾아 \"관련 노트\"로 제안합니다. 지난달에 적어둔 메모가 오늘 다시 떠오릅니다."],
    ];
    let y = 4.05;
    for (const [icon, t, d] of pairs) {
      badge(s, 0.9, y, 0.6, icon);
      s.addText(t, { x: 1.72, y: y - 0.04, w: 4.5, h: 0.4, fontFace: HEAD, bold: true, fontSize: 17, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 1.72, y: y + 0.36, w: 10.6, h: 0.62, fontFace: BODY, fontSize: 13, color: MUTED, margin: 0, lineSpacingMultiple: 1.25 });
      y += 1.35;
    }

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 6.55, w: 11.53, h: 0.62, fill: { color: SKY }, rectRadius: 0.09 });
    s.addText("흩어진 쪽지가 아니라, 이어진 기록이 됩니다.", { x: 1.25, y: 6.55, w: 10.9, h: 0.62, fontFace: BODY, fontSize: 13, bold: true, color: "1E3A8A", valign: "middle", margin: 0 });
    s.addNotes("노트-일정 양방향 연결과 추천, 노트끼리 관련 노트 제안.");
  }

  // ============ 7. 찾기 (질문) ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "찾기", 7.75, 0.72);
    s.addText("\"어디 적었더라?\"\n물어보면 찾아준다", { x: 7.75, y: 1.0, w: 4.9, h: 1.3, fontFace: HEAD, bold: true, fontSize: 27, color: INKTEXT, margin: 0, lineSpacingMultiple: 1.12 });

    shot(s, IMG("qa.png"), R_QA, 0.9, 1.5, 4.6);

    const items = [
      ["메모와 일정을 뒤져 답한다", "한 줄만 물으면 흩어진 기록을 대신 찾아 줍니다."],
      ["근거를 눌러 바로 이동", "답변에 붙은 노트·일정을 클릭하면 그 화면으로 갑니다."],
      ["무엇을 찾았는지 보여 준다", "어떤 검색을 몇 번 했는지 함께 표시합니다."],
    ];
    let y = 2.75;
    for (const [t, d] of items) {
      badge(s, 7.75, y + 0.02, 0.34, ic.chat, "E3F6EF");
      s.addText(t, { x: 8.23, y: y - 0.06, w: 4.4, h: 0.4, fontFace: HEAD, bold: true, fontSize: 15.5, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.23, y: y + 0.32, w: 4.5, h: 0.72, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.22;
    }
    s.addNotes("질문 기능: 노트·일정 검색 후 답변, 근거 칩으로 이동, 도구 호출 내역 표시.");
  }

  // ============ 8. 하루의 마무리 — 폭죽 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: -2.6, y: 3.6, w: 8.5, h: 8.5, fill: { color: BLUE_DK, transparency: 86 } });
    s.addShape(pres.shapes.OVAL, { x: 9.0, y: -3.0, w: 7.5, h: 7.5, fill: { color: BLUE, transparency: 86 } });

    // 색종이 조각
    const confetti = [
      [1.6, 1.15, AMBER, 12], [2.9, 0.8, MINT, -20], [4.4, 1.35, "60A5FA", 30],
      [6.0, 0.7, AMBER, -12], [7.6, 1.2, "F472B6", 22], [9.1, 0.85, MINT, -28],
      [10.6, 1.4, "60A5FA", 16], [11.9, 0.95, AMBER, -18], [3.6, 2.0, "F472B6", 8],
      [8.4, 2.05, "60A5FA", -24], [5.2, 2.15, MINT, 18], [10.0, 2.3, AMBER, -8],
    ];
    confetti.forEach(([x, y, color, rot]) => {
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.17, h: 0.28, rotate: rot, fill: { color } });
    });

    eyebrow(s, "END OF DAY", 0.95, 2.55, "8FB4FF");
    s.addText("오늘 하루도, 고생했어요", { x: 0.9, y: 2.85, w: 9.5, h: 0.95, fontFace: HEAD, bold: true, fontSize: 38, color: "FFFFFF", margin: 0 });
    s.addText("오늘의 마지막 일정을 끝내면 색종이가 터지고 응원 배너가 뜹니다.\n할 일을 지우는 앱이 아니라, 하루를 잘 마쳤다고 말해 주는 앱이고 싶었습니다.",
      { x: 0.95, y: 3.8, w: 9.5, h: 1.0, fontFace: BODY, fontSize: 15, color: ICE, margin: 0, lineSpacingMultiple: 1.35 });

    shot(s, IMG("celebrate-crop.png"), R_CEL, 1.35, 4.95, 2.4);
    s.addNotes("가장 강조할 슬라이드. 하루의 마지막 일정을 완료하면 색종이 효과와 '수고했어요' 배너가 뜬다. 애니메이션 줄이기 설정 시 정적 배너만.");
  }

  // ============ 9. 한 화면에 모인다 (대시보드) ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "한눈에", 0.9, 0.72);
    s.addText("오늘 뭐가 급한지, 한눈에", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });
    shot(s, IMG("dashboard.png"), R144, 0.9, 2.05, 5.0);

    const items = [
      ["마감·제출이 달력에", "급한 날이 먼저 눈에 띄고, 연가·출장은 셀 색으로 구분됩니다."],
      ["날짜를 누르면", "그 날 할 일만 목록으로. 상태 배지가 곧 필터입니다."],
      ["끝낸 일은 흐리게", "완료·취소는 가라앉고 남은 일만 또렷하게 남습니다."],
    ];
    let y = 2.15;
    for (const [t, d] of items) {
      badge(s, 8.5, y + 0.02, 0.34, ic.check, SKY);
      s.addText(t, { x: 8.98, y: y - 0.05, w: 3.9, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.98, y: y + 0.35, w: 3.95, h: 0.9, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.5;
    }
    s.addNotes("대시보드 월간 보기. 마감 표식, 선택일 목록, 상태별 구분.");
  }

  // ============ 10. 안심 + 클로징 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: 9.4, y: -2.6, w: 7, h: 7, fill: { color: BLUE, transparency: 86 } });

    eyebrow(s, "안심", 0.9, 0.85, "8FB4FF");
    s.addText("전부 내 컴퓨터에", { x: 0.9, y: 1.15, w: 9, h: 0.85, fontFace: HEAD, bold: true, fontSize: 33, color: "FFFFFF", margin: 0 });

    const cards = [
      [ic.lock, "계정도 서버도 없이", "모든 데이터는 브라우저 안(IndexedDB)에 저장됩니다."],
      [ic.check, "AI가 꺼져 있어도", "달력·노트·프로젝트는 그대로 동작합니다."],
      [ic.search, "백업은 파일 하나", "JSON으로 내보내고 되돌립니다."],
    ];
    const cw = 3.7, gap = 0.5;
    let x = 0.9;
    for (const [icon, t, d] of cards) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.35, w: cw, h: 2.15, fill: { color: INK2 }, rectRadius: 0.11 });
      badge(s, x + 0.4, 2.7, 0.55, icon);
      s.addText(t, { x: x + 0.4, y: 3.42, w: cw - 0.75, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: "FFFFFF", margin: 0 });
      s.addText(d, { x: x + 0.4, y: 3.82, w: cw - 0.7, h: 0.6, fontFace: BODY, fontSize: 12, color: ICE, margin: 0, lineSpacingMultiple: 1.25 });
      x += cw + gap;
    }

    s.addText([
      { text: "쏟아지는 쪽지는 ", options: { color: "FFFFFF", bold: true } },
      { text: "정리되고", options: { color: "8FB4FF", bold: true } },
      { text: ", 마감은 ", options: { color: "FFFFFF", bold: true } },
      { text: "먼저 보이고", options: { color: "8FB4FF", bold: true } },
      { text: ",", options: { color: "FFFFFF", bold: true, breakLine: true } },
      { text: "하루의 끝에는 ", options: { color: "FFFFFF", bold: true } },
      { text: "고생했다고 말해 준다", options: { color: AMBER, bold: true } },
      { text: ".", options: { color: "FFFFFF", bold: true } },
    ], { x: 0.9, y: 5.0, w: 11.6, h: 1.4, fontFace: HEAD, fontSize: 26, margin: 0, lineSpacingMultiple: 1.3, valign: "middle" });

    s.addText("플래나이(PLANAI)  ·  github.com/sohnjun96/AI-Planner", { x: 0.9, y: 6.6, w: 9, h: 0.4, fontFace: BODY, fontSize: 13, color: "7E93BE", margin: 0 });
    s.addNotes("로컬 우선 데이터 보관과 제품 철학으로 마무리.");
  }

  await pres.writeFile({ fileName: path.join(__dirname, "플래나이_소개.pptx") });
  console.log("deck written");
}

main().catch((e) => { console.error(e); process.exit(1); });
