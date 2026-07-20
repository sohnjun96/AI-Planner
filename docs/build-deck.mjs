import pptxgen from "pptxgenjs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import sharp from "sharp";
import {
  FaRegStickyNote, FaHourglassHalf, FaInbox, FaSearch,
  FaLock, FaFileExport, FaChartBar, FaCheck, FaCommentDots,
} from "react-icons/fa";
import { fileURLToPath } from "node:url";
import path from "node:path";

const Fa = { FaRegStickyNote, FaHourglassHalf, FaInbox, FaSearch, FaLock, FaFileExport, FaChartBar, FaCheck, FaCommentDots };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = (name) => path.join(__dirname, "images", name);

// ---- palette (앱 정체성: 딥 인디고 + 바이올렛 + 페이퍼) ----
const INK = "16172A";
const INK2 = "22233D";
const VIOLET = "6C5CE7";
const VIOLET_DK = "4A3FB5";
const LAV = "F1EFFC";
const LAV2 = "F7F6FE";
const PAPER = "FFFFFF";
const INKTEXT = "26263A";
const MUTED = "6E6E82";
const ICE = "C9C9E8";

const HEAD = "Malgun Gothic";
const BODY = "Malgun Gothic";

const softShadow = () => ({ type: "outer", color: "16172A", blur: 12, offset: 4, angle: 90, opacity: 0.1 });

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

function badge(slide, x, y, d, iconData, fill = VIOLET) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill } });
  const pad = d * 0.26;
  slide.addImage({ data: iconData, x: x + pad, y: y + pad, w: d - pad * 2, h: d - pad * 2 });
}

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

const R144 = 1440 / 1000;
const R_SCHED = 1120 / 1200;

const ic = {};

async function main() {
  ic.note = await iconPng(Fa.FaRegStickyNote, "#FFFFFF");
  ic.clock = await iconPng(Fa.FaHourglassHalf, "#FFFFFF");
  ic.inbox = await iconPng(Fa.FaInbox, "#FFFFFF");
  ic.search = await iconPng(Fa.FaSearch, "#FFFFFF");
  ic.lock = await iconPng(Fa.FaLock, "#FFFFFF");
  ic.file = await iconPng(Fa.FaFileExport, "#FFFFFF");
  ic.chart = await iconPng(Fa.FaChartBar, "#FFFFFF");
  ic.check = await iconPng(Fa.FaCheck, "#6C5CE7");
  ic.chat = await iconPng(Fa.FaCommentDots, "#18B69B");

  // ============ 1. 타이틀 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: 8.6, y: -2.2, w: 8, h: 8, fill: { color: VIOLET, transparency: 82 } });
    s.addShape(pres.shapes.OVAL, { x: 10.2, y: 3.4, w: 6, h: 6, fill: { color: VIOLET_DK, transparency: 86 } });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.0, y: 1.4, w: 0.86, h: 0.86, fill: { color: VIOLET }, rectRadius: 0.16 });
    s.addText("AI", { x: 1.0, y: 1.4, w: 0.86, h: 0.86, align: "center", valign: "middle", fontFace: HEAD, bold: true, fontSize: 22, color: "FFFFFF", margin: 0 });

    s.addText("플래나이(PLANAI)", { x: 0.95, y: 2.6, w: 9, h: 1.3, fontFace: HEAD, bold: true, fontSize: 60, color: "FFFFFF", margin: 0 });
    s.addText("흩어진 쪽지와 마감을, 한 곳에서", { x: 1.0, y: 3.95, w: 11, h: 0.7, fontFace: HEAD, fontSize: 26, color: "B7ADF7", bold: true, margin: 0 });
    s.addText("취합·제출·마감이 많은 하루를 자연어로 정리하는 업무 플래너.",
      { x: 1.0, y: 4.8, w: 10, h: 0.6, fontFace: BODY, fontSize: 16, color: ICE, margin: 0 });

    s.addText("쪽지 정리   ·   마감 관리   ·   자연어 입력   ·   내 컴퓨터에 보관", { x: 1.0, y: 6.5, w: 10, h: 0.4, fontFace: BODY, fontSize: 12.5, color: "7A7A98", bold: true, charSpacing: 1, margin: 0 });
    s.addNotes("플래나이(PLANAI) — 취합·제출·마감이 많은 사람을 위한 업무 플래너. 흩어진 쪽지를 정리하고, 마감을 먼저 보여 주고, 자연어로 일정을 넣는다.");
  }

  // ============ 2. 이런 하루, 익숙하신가요 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "WHY", 0.9, 0.75);
    s.addText("이런 하루, 익숙하신가요", { x: 0.9, y: 1.05, w: 8.5, h: 0.9, fontFace: HEAD, bold: true, fontSize: 33, color: INKTEXT, margin: 0 });

    const rows = [
      [ic.note, "쪽지가 여기저기 흩어진다", "회의 메모, 취합 요청, 제출 목록이 앱마다 따로 논다."],
      [ic.clock, "마감이 코앞인데 안 보인다", "무엇부터 급한지 한눈에 들어오지 않는다."],
      [ic.inbox, "취합하고 제출하길 반복한다", "여기저기서 받아 모아, 정해진 기한에 낸다."],
      [ic.search, "\"그거 어디 적었더라\"", "필요할 때마다 메모를 뒤지느라 시간을 쓴다."],
    ];
    let y = 2.25;
    for (const [icon, title, desc] of rows) {
      badge(s, 0.9, y, 0.62, icon);
      s.addText(title, { x: 1.75, y: y - 0.03, w: 6.4, h: 0.4, fontFace: HEAD, bold: true, fontSize: 17, color: INKTEXT, margin: 0 });
      s.addText(desc, { x: 1.75, y: y + 0.36, w: 6.6, h: 0.5, fontFace: BODY, fontSize: 13, color: MUTED, margin: 0 });
      y += 1.12;
    }

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.85, y: 2.15, w: 3.65, h: 3.9, fill: { color: LAV }, rectRadius: 0.14, shadow: softShadow() });
    s.addText("그래서,", { x: 9.2, y: 2.55, w: 3.1, h: 0.4, fontFace: HEAD, bold: true, fontSize: 15, color: VIOLET_DK, margin: 0 });
    s.addText([
      { text: "쪽지는 ", options: { color: INKTEXT, bold: true } },
      { text: "정리되고,", options: { color: VIOLET, bold: true, breakLine: true } },
      { text: "마감은 ", options: { color: INKTEXT, bold: true } },
      { text: "먼저 보이고,", options: { color: VIOLET, bold: true, breakLine: true } },
      { text: "찾을 땐 ", options: { color: INKTEXT, bold: true } },
      { text: "물어본다.", options: { color: VIOLET, bold: true } },
    ], { x: 9.2, y: 3.1, w: 3.05, h: 2.1, fontFace: HEAD, fontSize: 18, color: INKTEXT, margin: 0, lineSpacingMultiple: 1.35, valign: "top" });
    s.addNotes("대상 사용자의 하루 통증 4가지 → 해법 한 줄로 연결.");
  }

  // ============ 3. 대시보드 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "한눈에", 0.9, 0.7);
    s.addText("오늘 뭐가 급한지, 한눈에", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });
    shot(s, IMG("dashboard.png"), R144, 0.9, 2.05, 5.0);

    const items = [
      ["마감·제출이 달력에", "제출·중요 표식으로 급한 날이 먼저 눈에 띈다. 연가·출장도 셀 색으로 구분."],
      ["날짜를 누르면", "그 날 해야 할 일만 목록으로. 남은 것부터 위로 올라온다."],
      ["끝낸 일은 흐리게", "완료·취소는 가라앉고, 남은 일만 또렷하게 남는다."],
    ];
    let y = 2.15;
    for (const [t, d] of items) {
      badge(s, 8.5, y + 0.02, 0.34, ic.check, LAV);
      s.addText(t, { x: 8.98, y: y - 0.05, w: 3.9, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.98, y: y + 0.35, w: 3.95, h: 0.9, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.5;
    }
    s.addNotes("대시보드: 마감·제출이 달력에 표식으로, 날짜 클릭 시 그날 할 일, 상태로 구분.");
  }

  // ============ 4. 노트 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "쪽지", 0.9, 0.7);
    s.addText("흩어진 쪽지를, 쌓아서 쓴다", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 32, color: INKTEXT, margin: 0 });
    shot(s, IMG("notes.png"), R144, 0.9, 2.05, 5.0);

    const items = [
      ["알아서 분류된다", "새 쪽지를 프로젝트·주제별로 자동으로 묶어, 뒤질 일이 줄어든다."],
      ["취합은 체크리스트로", "받을 항목을 체크하며 관리하고, 남은 건 한 곳에 모아 본다."],
      ["놓치지 않는 저장", "다른 쪽지로 넘어가도 자동 저장, 순서도 끌어서 바꾼다."],
    ];
    let y = 2.15;
    for (const [t, d] of items) {
      badge(s, 8.5, y + 0.02, 0.34, ic.check, LAV);
      s.addText(t, { x: 8.98, y: y - 0.05, w: 3.9, h: 0.4, fontFace: HEAD, bold: true, fontSize: 16, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.98, y: y + 0.35, w: 3.95, h: 0.9, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.5;
    }
    s.addNotes("노트: 자동 분류, 취합 체크리스트(+전체 모아보기), 자동 저장, 이어 보기.");
  }

  // ============ 5. AI 일정 추가 ============
  {
    const s = pres.addSlide();
    s.background = { color: LAV2 };
    eyebrow(s, "빠른 입력", 0.9, 0.7);
    s.addText("말하면, 일정이 된다", { x: 0.9, y: 1.0, w: 8.5, h: 0.8, fontFace: HEAD, bold: true, fontSize: 31, color: INKTEXT, margin: 0 });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 2.15, w: 6.4, h: 0.7, fill: { color: PAPER }, line: { color: VIOLET, width: 1.25 }, rectRadius: 0.1, shadow: softShadow() });
    s.addText([
      { text: "“", options: { color: VIOLET, bold: true } },
      { text: "금요일까지 실적보고 제출 잡아줘", options: { color: INKTEXT, bold: true } },
      { text: "”", options: { color: VIOLET, bold: true } },
    ], { x: 1.15, y: 2.15, w: 6, h: 0.7, fontFace: HEAD, fontSize: 18, valign: "middle", margin: 0 });

    s.addText([
      { text: "날짜·마감·종류를 알아서 채운다.", options: { bold: true, color: INKTEXT, breakLine: true } },
      { text: "바로 저장하지 않고 초안을 먼저 보여 주니, 확인하고 넣으면 끝.", options: { color: MUTED } },
    ], { x: 0.9, y: 3.1, w: 6.4, h: 1.0, fontFace: BODY, fontSize: 14.5, margin: 0, lineSpacingMultiple: 1.25 });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 4.35, w: 6.4, h: 1.95, fill: { color: LAV }, rectRadius: 0.12 });
    s.addText("반복되는 기준은 기억한다", { x: 1.2, y: 4.6, w: 5.8, h: 0.45, fontFace: HEAD, bold: true, fontSize: 16, color: VIOLET_DK, margin: 0 });
    s.addText([
      { text: "\"제출은 오후 6시, 점심은 11시반\" 처럼 늘 쓰는 기준을 ", options: { color: INKTEXT } },
      { text: "규칙으로 저장", options: { color: VIOLET, bold: true } },
      { text: "해 두면, 다음부터는 시간을 말하지 않아도 알아서 채워 준다.", options: { color: INKTEXT } },
    ], { x: 1.2, y: 5.1, w: 5.85, h: 1.1, fontFace: BODY, fontSize: 13, margin: 0, lineSpacingMultiple: 1.28 });

    shot(s, IMG("ai-schedule.png"), R_SCHED, 8.35, 0.55, 6.35);
    s.addNotes("자연어로 일정 입력 → 초안 먼저 확인 → 적용. 반복되는 마감 기준은 규칙으로 학습.");
  }

  // ============ 6. 질문 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "찾기", 8.05, 0.7);
    s.addText("\"어디 적었더라?\"\n물어보면 찾아준다", { x: 8.05, y: 1.0, w: 4.8, h: 1.3, fontFace: HEAD, bold: true, fontSize: 27, color: INKTEXT, margin: 0, lineSpacingMultiple: 1.1 });

    shot(s, IMG("qa.png"), R144, 0.9, 1.5, 4.6);

    const items = [
      ["메모와 일정을 뒤져 답한다", "\"표준특허 관련 정리한 거\" 한 줄이면 찾아 준다."],
      ["바로 그 화면으로", "찾은 메모·일정을 눌러 곧장 이동한다."],
      ["근거도 같이 보여 준다", "어디서 찾았는지 함께 확인할 수 있다."],
    ];
    let y = 2.7;
    for (const [t, d] of items) {
      badge(s, 8.05, y + 0.02, 0.34, ic.chat, "E4F6F1");
      s.addText(t, { x: 8.53, y: y - 0.05, w: 4.4, h: 0.4, fontFace: HEAD, bold: true, fontSize: 15.5, color: INKTEXT, margin: 0 });
      s.addText(d, { x: 8.53, y: y + 0.35, w: 4.5, h: 0.7, fontFace: BODY, fontSize: 12.5, color: MUTED, margin: 0, lineSpacingMultiple: 1.2 });
      y += 1.25;
    }
    s.addNotes("질문 기능: 메모·일정을 검색해 답하고, 근거 항목으로 바로 이동.");
  }

  // ============ 7. 데이터 · 안심 ============
  {
    const s = pres.addSlide();
    s.background = { color: PAPER };
    eyebrow(s, "안심", 0.9, 0.7);
    s.addText("전부 내 컴퓨터에, 백업은 파일 하나", { x: 0.9, y: 1.0, w: 9, h: 0.8, fontFace: HEAD, bold: true, fontSize: 31, color: INKTEXT, margin: 0 });

    const cards = [
      [ic.lock, "내 브라우저에만", "계정도 서버도 없이 내 컴퓨터에 저장된다."],
      [ic.file, "통째로 백업·복구", "파일 하나로 옮기고, 필요하면 되돌린다."],
      [ic.chart, "쌓인 현황을 한눈에", "일정·메모·사용량을 통계로 확인한다."],
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
    s.addNotes("내 브라우저 저장(로컬), JSON 백업·복구, 통계로 현황 확인.");
  }

  // ============ 8. 클로징 ============
  {
    const s = pres.addSlide();
    s.background = { color: INK };
    s.addShape(pres.shapes.OVAL, { x: -2.4, y: 3.2, w: 8, h: 8, fill: { color: VIOLET_DK, transparency: 84 } });
    s.addShape(pres.shapes.OVAL, { x: 9.4, y: -2.6, w: 7, h: 7, fill: { color: VIOLET, transparency: 84 } });

    s.addText([
      { text: "쪽지는 ", options: { color: "FFFFFF", bold: true } },
      { text: "정리되고", options: { color: "B7ADF7", bold: true } },
      { text: ", 마감은 ", options: { color: "FFFFFF", bold: true } },
      { text: "먼저 보이고", options: { color: "B7ADF7", bold: true } },
      { text: ",", options: { color: "FFFFFF", bold: true, breakLine: true } },
      { text: "찾을 땐 ", options: { color: "FFFFFF", bold: true } },
      { text: "물어본다", options: { color: "B7ADF7", bold: true } },
      { text: ".", options: { color: "FFFFFF", bold: true } },
    ], { x: 1.2, y: 2.4, w: 11.4, h: 2.0, fontFace: HEAD, fontSize: 32, margin: 0, lineSpacingMultiple: 1.32, valign: "middle" });

    s.addText("플래나이(PLANAI)", { x: 1.2, y: 4.55, w: 6, h: 0.7, fontFace: HEAD, bold: true, fontSize: 26, color: "8B7CF0", margin: 0 });
    s.addText("github.com/sohnjun96/AI-Planner", { x: 1.2, y: 5.3, w: 9, h: 0.4, fontFace: BODY, fontSize: 14, color: "8A8AA8", margin: 0 });
    s.addNotes("클로징: 제품 가치 한 줄과 저장소 링크.");
  }

  await pres.writeFile({ fileName: path.join(__dirname, "플래나이_PLANAI_소개.pptx") });
  console.log("deck written");
}

main().catch((e) => { console.error(e); process.exit(1); });
