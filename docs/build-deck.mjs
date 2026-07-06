import pptxgen from "pptxgenjs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import sharp from "sharp";
import {
  FaLayerGroup, FaRegEyeSlash, FaRedoAlt, FaKeyboard, FaBolt,
  FaLock, FaFileExport, FaChartBar, FaCheck,
} from "react-icons/fa";
const Fa = { FaLayerGroup, FaRegEyeSlash, FaRedoAlt, FaKeyboard, FaBolt, FaLock, FaFileExport, FaChartBar, FaCheck };
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = (name) => path.join(__dirname, "images", name);

// ---- palette (앱 정체성: 딥 인디고 + 바이올렛 + 페이퍼) ----
const INK = "16172A";       // 다크 배경
const INK2 = "22233D";      // 다크 카드
const VIOLET = "6C5CE7";    // 주 강조
const VIOLET_DK = "4A3FB5";
const LAV = "F1EFFC";       // 라벤더 카드 틴트
const LAV2 = "F7F6FE";      // 은은한 배경 틴트
const PAPER = "FFFFFF";
const INKTEXT = "26263A";   // 본문
const MUTED = "6E6E82";     // 보조
const ICE = "C9C9E8";       // 다크 위 보조 텍스트
const CORAL = "E8895A";     // 따뜻한 포인트 (숫자 강조 전용)

const HEAD = "Malgun Gothic";
const BODY = "Malgun Gothic";

const shadow = () => ({ type: "outer", color: "16172A", blur: 9, offset: 3, angle: 90, opacity: 0.16 });
const softShadow = () => ({ type: "outer", color: "16172A", blur: 12, offset: 4, angle: 90, opacity: 0.1 });

const pres = new pptxgen();
pres.defineLayout({ name: "W", width: 13.33, height: 7.5 });
pres.layout = "W";
pres.author = "일정아이";
pres.title = "일정아이 소개";

const W = 13.33, H = 7.5;

async function iconPng(Icon, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Icon, { color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// 원형 배지 안에 아이콘
function badge(slide, x, y, d, iconData, fill = VIOLET) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill } });
  const pad = d * 0.26;
  slide.addImage({ data: iconData, x: x + pad, y: y + pad, w: d - pad * 2, h: d - pad * 2 });
}

// 스크린샷을 라운드 프레임 위에 배치 (종횡비 유지)
function shot(slide, img, ratio, x, y, h) {
  const w = h * ratio;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12,
    fill: { color: PAPER }, line: { color: "E6E4F5", width: 1 }, rectRadius: 0.09, shadow: softShadow(),
  });
  slide.addImage({ path: img, x, y, w, h });
  return w;
}

function eyebrow(slide, text, x, y, color = VIOLET) {
  slide.addText(text, { x, y, w: 6, h: 0.3, fontFace: HEAD, fontSize: 11, bold: true, color, charSpacing: 3, margin: 0 });
}

const R144 = 1440 / 1000; // 가로 스크린샷
const R_SCHED = 1120 / 1200; // 세로 스크린샷

const ic = {};

async function main() {
  ic.layers = await iconPng(Fa.FaLayerGroup, "#FFFFFF");
  ic.eye = await iconPng(Fa.FaRegEyeSlash, "#FFFFFF");
  ic.redo = await iconPng(Fa.FaRedoAlt, "#FFFFFF");
  ic.keyboard = await iconPng(Fa.FaKeyboard, "#FFFFFF");
  ic.bolt = await iconPng(Fa.FaBolt, "#FFFFFF");
  ic.lock = await iconPng(Fa.FaLock, "#FFFFFF");
  ic.file = await iconPng(Fa.FaFileExport, "#FFFFFF");
  ic.chart = await iconPng(Fa.FaChartBar, "#FFFFFF");
  ic.check = await iconPng(Fa.FaCheck, "#6C5CE7");
  ic.checkW = await iconPng(Fa.FaCheck, "#18B69B");

  // ============ 1. 타이틀 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    // 은은한 바이올렛 글로우
    s.addShape(pres.shapes.OVAL, { x: 8.6, y: -2.2, w: 8, h: 8, fill: { color: VIOLET, transparency: 82 } });
    s.addShape(pres.shapes.OVAL, { x: 10.2, y: 3.4, w: 6, h: 6, fill: { color: VIOLET_DK, transparency: 86 } });

    // 앱 마크
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.0, y: 1.5, w: 0.86, h: 0.86, fill: { color: VIOLET }, rectRadius: 0.16 });
    s.addText("AI", { x: 1.0, y: 1.5, w: 0.86, h: 0.86, align: "center", valign: "middle", fontFace: HEAD, bold: true, fontSize: 22, color: "FFFFFF", margin: 0 });

    s.addText("일정아이", { x: 0.95, y: 2.75, w: 9, h: 1.3, fontFace: HEAD, bold: true, fontSize: 60, color: "FFFFFF", margin: 0 });
    s.addText("말하면 정리되는 업무 플래너", { x: 1.0, y: 4.05, w: 10, h: 0.7, fontFace: HEAD, fontSize: 26, color: VIOLET === "6C5CE7" ? "B7ADF7" : ICE, bold: true, margin: 0 });
    s.addText("달력 · 노트 · 프로젝트를 한곳에서 관리하고, 자연어로 일정을 넣고 내 데이터에 질문하는 로컬 우선 플래너.",
      { x: 1.0, y: 4.85, w: 9.6, h: 0.8, fontFace: BODY, fontSize: 15, color: ICE, margin: 0, lineSpacingMultiple: 1.25 });

    s.addText("React 19  ·  TypeScript  ·  IndexedDB  ·  Local-first", { x: 1.0, y: 6.55, w: 9, h: 0.4, fontFace: BODY, fontSize: 12.5, color: "7A7A98", bold: true, charSpacing: 1, margin: 0 });
    s.addNotes("일정아이 소개. 로컬에 저장되고 자연어로 움직이는 업무 플래너. React 19 + TypeScript, Dexie(IndexedDB) 기반 SPA이자 Chrome 확장.");
  }

  // ============ 2. 문제 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "WHY", 0.9, 0.75);
    s.addText("매번 앱을 옮겨 다니지 않아도", { x: 0.9, y: 1.05, w: 8.5, h: 0.9, fontFace: HEAD, bold: true, fontSize: 33, color: INKTEXT, margin: 0 });

    const rows = [
      [ic.layers, "성격이 다른 일정이 섞인다", "제출·회의·점심·연가·출장이 뒤섞이면 우선순위를 놓친다."],
      [ic.eye, "지나간 일이 오늘을 가린다", "완료·취소된 일이 지금 할 일 위로 겹쳐 보인다."],
      [ic.redo, "같은 규칙을 매번 입력한다", "\"점심은 11:30, 제출은 18:00\" 같은 습관을 손으로 반복한다."],
      [ic.keyboard, "입력 폼은 여전히 번거롭다", "\"내일 10시에 보고서 제출\"이라고 말하고 싶다."],
    ];
    let y = 2.25;
    for (const [icon, title, desc] of rows) {
      badge(s, 0.9, y, 0.62, icon);
      s.addText(title, { x: 1.75, y: y - 0.03, w: 6.4, h: 0.4, fontFace: HEAD, bold: true, fontSize: 17, color: INKTEXT, margin: 0 });
      s.addText(desc, { x: 1.75, y: y + 0.36, w: 6.6, h: 0.5, fontFace: BODY, fontSize: 13, color: MUTED, margin: 0 });
      y += 1.12;
    }

    // 오른쪽 라벤더 카드 (해법 한 줄)
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.85, y: 2.15, w: 3.65, h: 3.9, fill: { color: LAV }, rectRadius: 0.14, shadow: softShadow() });
    s.addText("그래서,", { x: 9.2, y: 2.55, w: 3.1, h: 0.4, fontFace: HEAD, bold: true, fontSize: 15, color: VIOLET_DK, margin: 0 });
    s.addText([
      { text: "말하면 ", options: { color: VIOLET, bold: true } },
      { text: "초안이 나오고,", options: { color: INKTEXT, bold: true, breakLine: true } },
      { text: "반복은 ", options: { color: VIOLET, bold: true } },
      { text: "스스로 규칙이 된다.", options: { color: INKTEXT, bold: true } },
    ], { x: 9.2, y: 3.1, w: 3.05, h: 1.7, fontFace: HEAD, fontSize: 17, color: INKTEXT, margin: 0, lineSpacingMultiple: 1.32, valign: "top" });
    s.addText("확인하고 적용하는 흐름은 그대로.", { x: 9.2, y: 5.35, w: 3.05, h: 0.5, fontFace: BODY, fontSize: 12, color: MUTED, margin: 0 });
    s.addNotes("실제 업무의 통증 4가지를 짚고, 해법의 한 줄 요약으로 넘어간다.");
  }

  // ============ 3. 대시보드 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "DASHBOARD", 0.9, 0.7);
    s.addText("이번 달을 한 장에", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });
    shot(s, IMG("dashboard.png"), R144, 0.9, 2.05, 5.0);

    const items = [
      ["상태로 구분", "미완료는 또렷하게, 완료·취소는 흐리게. 연가는 초록, 출장은 파랑으로 셀이 물든다."],
      ["날짜를 누르면", "달력과 메모 사이에 그 날 일정만 목록으로. 상태 배지가 곧 필터."],
      ["우클릭으로 빠르게", "완료·보류·수정·복제·삭제와 연가 설정을 달력에서 바로."],
    ];
    let y = 2.15;
    for (const [t, d] of items) {
      badge(s, 8.5, y + 0.02, 0.34, ic.check, LAV);
      s.addText(t, { x: 8.98, y: y - 0.05, w: 3.9, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.98, y: y + 0.35, w: 3.95, h: 0.9, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.5;
    }
    s.addNotes("대시보드 월간 보기. 상태별 색 구분, 날짜 클릭 시 그 날 일정, 우클릭 빠른 처리.");
  }

  // ============ 4. 노트 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "NOTES", 0.9, 0.7);
    s.addText("쓰고, 묶고, 이어 보기", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });
    shot(s, IMG("notes.png"), R144, 0.9, 2.05, 5.0);

    const items = [
      ["자동 제목·분류", "본문 첫 줄에서 제목을 따오고, 프로젝트·세부 항목을 백그라운드에서 추천."],
      ["이어 보기", "카테고리를 고르면 노트가 위아래로 펼쳐지고, 체크박스는 그 자리에서 토글."],
      ["잃지 않는 편집", "카드를 끌어 순서를 바꾸고, 다른 노트로 넘어가도 자동 저장."],
    ];
    let y = 2.15;
    for (const [t, d] of items) {
      badge(s, 8.5, y + 0.02, 0.34, ic.check, LAV);
      s.addText(t, { x: 8.98, y: y - 0.05, w: 3.9, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.98, y: y + 0.35, w: 3.95, h: 0.9, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.5;
    }
    s.addNotes("마크다운 노트, 자동 제목/분류, 스택 이어보기, 자동 저장, 일정 연결.");
  }

  // ============ 5. AI 일정 추가 ============
  {
    const s = pres.addSlide();
    s.background = { color: LAV2 };
    eyebrow(s, "AI SCHEDULE", 0.9, 0.7);
    s.addText("자연어 한 줄이면 초안이 나온다", { x: 0.9, y: 1.0, w: 8.5, h: 0.8, fontFace: HEAD, bold: true, fontSize: 31, color: INKTEXT, margin: 0 });

    // 입력 예시 칩
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 2.15, w: 6.4, h: 0.7, fill: { color: PAPER }, line: { color: VIOLET, width: 1.25 }, rectRadius: 0.1, shadow: softShadow() });
    s.addText([
      { text: "“", options: { color: VIOLET, bold: true } },
      { text: "내일 11시반에 김선임과 점심", options: { color: INKTEXT, bold: true } },
      { text: "”", options: { color: VIOLET, bold: true } },
    ], { x: 1.15, y: 2.15, w: 6, h: 0.7, fontFace: HEAD, fontSize: 18, valign: "middle", margin: 0 });

    s.addText([
      { text: "AI는 바로 저장하지 않는다.", options: { bold: true, color: INKTEXT, breakLine: true } },
      { text: "날짜·시간·프로젝트·종류를 채운 초안을 먼저 보여 주고, 확인해서 적용한다.", options: { color: MUTED } },
    ], { x: 0.9, y: 3.1, w: 6.4, h: 1.0, fontFace: BODY, fontSize: 14.5, margin: 0, lineSpacingMultiple: 1.25 });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 4.35, w: 6.4, h: 1.95, fill: { color: LAV }, rectRadius: 0.12 });
    s.addText("반복되는 습관은 규칙이 된다", { x: 1.2, y: 4.6, w: 5.8, h: 0.45, fontFace: HEAD, bold: true, fontSize: 16, color: VIOLET_DK, margin: 0 });
    s.addText([
      { text: "\"점심은 11시반, 점심 약속 프로젝트\" 같은 패턴을 ", options: { color: INKTEXT } },
      { text: "재사용 규칙", options: { color: VIOLET, bold: true } },
      { text: "으로 제안한다. 규칙을 먼저 검토·저장하면 ", options: { color: INKTEXT } },
      { text: "user.md", options: { color: VIOLET_DK, bold: true } },
      { text: "에 남아 다음부터 자동 적용.", options: { color: INKTEXT } },
    ], { x: 1.2, y: 5.1, w: 5.85, h: 1.1, fontFace: BODY, fontSize: 13, margin: 0, lineSpacingMultiple: 1.28 });

    // 세로 스크린샷 우측
    shot(s, IMG("ai-schedule.png"), R_SCHED, 8.35, 0.55, 6.35);
    s.addNotes("자연어 → 초안(바로 저장 안 함) + 재사용 규칙 제안. 규칙은 user.md에 저장되어 자동 적용.");
  }

  // ============ 6. 질문 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "ASK YOUR DATA", 8.05, 0.7);
    s.addText("내 노트와 일정에 물어보기", { x: 8.05, y: 1.0, w: 4.8, h: 1.2, fontFace: HEAD, bold: true, fontSize: 28, color: INKTEXT, margin: 0, lineSpacingMultiple: 1.05 });

    shot(s, IMG("qa.png"), R144, 0.9, 1.35, 4.7);

    const items = [
      ["검색해서 답한다", "노트와 일정을 뒤져 근거 있는 답을 만든다."],
      ["참고 칩으로 이동", "근거가 된 노트·일정을 눌러 바로 그 화면으로."],
      ["도구 호출을 투명하게", "🔎 줄이 어떤 검색을 몇 번 했는지 보여 준다."],
    ];
    let y = 2.4;
    for (const [t, d] of items) {
      badge(s, 8.05, y + 0.02, 0.34, ic.checkW, "E4F6F1");
      s.addText(t, { x: 8.53, y: y - 0.05, w: 4.4, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.53, y: y + 0.35, w: 4.5, h: 0.7, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.28;
    }
    s.addNotes("Q&A: 검색해서 답, 참고 칩으로 이동, 도구 호출 내역 표시. 제목 카탈로그를 함께 실어 도구 없이도 답 가능.");
  }

  // ============ 7. 작동 방식 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    eyebrow(s, "HOW IT WORKS", 0.9, 0.7, "B7ADF7");
    s.addText("AI는 이렇게 움직인다", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: "FFFFFF", margin: 0 });
    s.addText("네이티브 function calling 없이, 프롬프트로 도구를 지시하고 결과를 다시 물어보는 루프.", { x: 0.9, y: 1.78, w: 11, h: 0.4, fontFace: BODY, fontSize: 14, color: ICE, margin: 0 });

    const steps = [
      ["1", "지시", "프롬프트로 JSON 스키마와 도구 목록을 준다."],
      ["2", "호출", "모델이 필요한 도구 호출을 JSON으로 반환한다."],
      ["3", "실행", "앱이 로컬에서 실행하고 결과를 붙인다."],
      ["4", "반복", "결과로 다시 질의 — 최대 4라운드."],
    ];
    const cw = 2.86, gap = 0.24;
    let x = 0.9;
    for (const [n, t, d] of steps) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.5, w: cw, h: 2.0, fill: { color: INK2 }, rectRadius: 0.1 });
      s.addShape(pres.shapes.OVAL, { x: x + 0.28, y: 2.78, w: 0.6, h: 0.6, fill: { color: VIOLET } });
      s.addText(n, { x: x + 0.28, y: 2.78, w: 0.6, h: 0.6, align: "center", valign: "middle", fontFace: HEAD, bold: true, fontSize: 22, color: "FFFFFF", margin: 0 });
      s.addText(t, { x: x + 0.28, y: 3.55, w: cw - 0.5, h: 0.4, fontFace: HEAD, bold: true, fontSize: 18, color: "FFFFFF", margin: 0 });
      s.addText(d, { x: x + 0.28, y: 3.95, w: cw - 0.5, h: 0.5, fontFace: BODY, fontSize: 12, color: ICE, margin: 0, lineSpacingMultiple: 1.15 });
      x += cw + gap;
    }

    // 하단: 에이전트 4종 + 로컬 모델
    const tags = ["scheduleAgent — 일정 초안·규칙", "qaAgent — 질의응답", "notesAgent — 편집·요약", "briefingAgent — 아침 브리핑"];
    let tx = 0.9;
    for (const tag of tags) {
      const tw = 2.86;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: tx, y: 4.95, w: tw, h: 0.9, fill: { color: "1E1F36" }, rectRadius: 0.08 });
      s.addText(tag, { x: tx + 0.2, y: 4.95, w: tw - 0.35, h: 0.9, fontFace: BODY, fontSize: 11.5, color: "C9C9E8", valign: "middle", margin: 0, lineSpacingMultiple: 1.15 });
      tx += tw + gap;
    }
    s.addText([
      { text: "덕분에 로컬 모델을 포함한 어떤 OpenAI 호환 엔드포인트와도 붙는다.", options: { color: "B7ADF7", bold: true } },
    ], { x: 0.9, y: 6.25, w: 11.5, h: 0.5, fontFace: BODY, fontSize: 14, margin: 0 });
    s.addNotes("JSON-in-prompt 방식의 도구 호출 루프(최대 4라운드). 4개 에이전트가 공용 인프라를 공유. 네이티브 function calling 불필요 → 로컬 모델 호환.");
  }

  // ============ 8. 데이터 & 통계 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "DATA & STATS", 0.9, 0.7);
    s.addText("내 데이터는 내 브라우저에", { x: 0.9, y: 1.0, w: 8, h: 0.8, fontFace: HEAD, bold: true, fontSize: 31, color: INKTEXT, margin: 0 });

    const cards = [
      [ic.lock, "로컬 우선", "모든 데이터는 IndexedDB에. 계정도 서버도 없다."],
      [ic.file, "JSON 내보내기·되돌리기", "백업과 이전이 파일 하나로 끝난다."],
      [ic.chart, "AI 토큰 집계", "오늘·누적 사용량을 통계 탭에서 확인."],
    ];
    let y = 2.15;
    for (const [icon, t, d] of cards) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y, w: 5.6, h: 1.15, fill: { color: LAV2 }, rectRadius: 0.1 });
      badge(s, 1.15, y + 0.26, 0.62, icon);
      s.addText(t, { x: 2.0, y: y + 0.2, w: 4.3, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 2.0, y: y + 0.58, w: 4.35, h: 0.5, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0 });
      y += 1.35;
    }

    shot(s, IMG("stats.png"), R144, 7.1, 2.0, 4.55);
    s.addNotes("로컬 우선(IndexedDB), JSON 내보내기/되돌리기, AI 토큰 사용량 집계. 설정의 통계 탭.");
  }

  // ============ 9. 클로징 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: -2.4, y: 3.2, w: 8, h: 8, fill: { color: VIOLET_DK, transparency: 84 } });
    s.addShape(pres.shapes.OVAL, { x: 9.4, y: -2.6, w: 7, h: 7, fill: { color: VIOLET, transparency: 84 } });

    s.addText([
      { text: "로컬에 남고, ", options: { color: "FFFFFF", bold: true } },
      { text: "자연어로 움직이고, ", options: { color: "B7ADF7", bold: true } },
      { text: "반복은 스스로 학습한다.", options: { color: "FFFFFF", bold: true } },
    ], { x: 1.2, y: 2.55, w: 11, h: 1.8, fontFace: HEAD, fontSize: 34, margin: 0, lineSpacingMultiple: 1.25, valign: "middle" });

    s.addText("일정아이", { x: 1.2, y: 4.5, w: 6, h: 0.7, fontFace: HEAD, bold: true, fontSize: 26, color: VIOLET === "6C5CE7" ? "8B7CF0" : ICE, margin: 0 });
    s.addText("github.com/sohnjun96/AI-Planner", { x: 1.2, y: 5.25, w: 9, h: 0.4, fontFace: BODY, fontSize: 14, color: "8A8AA8", margin: 0 });
    s.addNotes("클로징: 제품 철학 한 줄과 저장소 링크.");
  }

  await pres.writeFile({ fileName: path.join(__dirname, "일정아이_소개.pptx") });
  console.log("deck written");
}

main().catch((e) => { console.error(e); process.exit(1); });
