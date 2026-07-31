// 데모 녹화용 목 LLM 서버 (OpenAI 호환 chat completions)
import http from "node:http";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

let n = 0;

/**
 * 다가오는 특정 요일(1=월…5=금). 이미 지난 요일이면 다음 주로 넘긴다.
 * 실제 AI도 지난 날짜에 새 약속을 잡지는 않으므로 이렇게 해석한다.
 */
function thisWeek(dow, h, mi = 0) {
  const now = new Date();
  const cur = now.getDay() || 7; // 일=7
  let diff = dow - cur;
  if (diff <= 0) {
    diff += 7;
  }
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, h, mi);
  return d.toISOString();
}
function nextWeek(dow, h, mi = 0) {
  const now = new Date();
  const cur = now.getDay() || 7;
  const diff = dow - cur + 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, h, mi);
  return d.toISOString();
}

const op = (title, taskTypeId, projectId, startAt, isMajor = false, endAt = "") => ({
  action: "create_task",
  title,
  content: "",
  projectId,
  taskTypeId,
  status: "NOT_DONE",
  startAt,
  endAt,
  isMajor,
});

// 1) "다음주 금요일까지 교육 이수 후 실적 제출" → 마감 기준 1건
const trainingThenReport = {
  assistantMessage: "다음 주 금요일 마감으로 정리했어요.",
  needsUserInput: false,
  userQuestion: "",
  toolCalls: [],
  proposal: {
    summary: "교육 이수 후 실적 제출 1건 추가",
    operations: [op("교육 이수 후 실적 제출", "type-submit", "project-report", nextWeek(5, 18, 0), true)],
  },
  contextSuggestions: [],
};

// 2) "이번주 수요일 점심 김키포와" → 식사 1건
const lunchWithKipo = {
  assistantMessage: "이번 주 수요일 점심 약속으로 정리했어요.",
  needsUserInput: false,
  userQuestion: "",
  toolCalls: [],
  proposal: {
    summary: "점심 약속 1건 추가",
    operations: [op("김키포와 점심", "type-meal", "project-lunch", thisWeek(3, 12, 0))],
  },
  contextSuggestions: [],
};

/** payload.userRequest만 보고 판별한다 (user.md 기본 규칙에 '점심'이 들어 있어 전체 body 검색은 오탐) */
function readUserRequest(body) {
  try {
    const parsed = JSON.parse(body);
    const userMsg = [...parsed.messages].reverse().find((m) => m.role === "user");
    const payload = JSON.parse(userMsg.content);
    return String(payload.userRequest ?? "");
  } catch {
    return "";
  }
}

// MOCK_RULES=1 이면 재사용 규칙 제안을 함께 반환한다 (규칙 UI 스크린샷용)
const RULE_SUGGESTIONS = [
  {
    category: "time",
    label: "제출 기본 시간",
    trigger: ["제출", "마감"],
    defaultTime: "18:00",
    taskTypeId: "type-submit",
    isMajor: false,
    reason: "제출 일정에 시간이 없으면 오후 6시로 맞춥니다.",
  },
  {
    category: "classification",
    label: "실적 관련은 보고 프로젝트로",
    trigger: ["실적", "보고"],
    taskTypeId: "type-submit",
    projectId: "project-report",
    isMajor: false,
    reason: "실적·보고 키워드 일정은 보고 프로젝트로 분류합니다.",
  },
];

// 3) "다음주 월화수 서울 출장" → 여러 날에 걸친 일정 1건 (startAt~endAt 범위)
const seoulTrip = {
  assistantMessage: "다음 주 월요일부터 수요일까지 출장 일정으로 정리했어요.",
  needsUserInput: false,
  userQuestion: "",
  toolCalls: [],
  proposal: {
    summary: "다음 주 월요일부터 수요일까지 서울 출장 일정을 1건 추가합니다.",
    operations: [op("서울 출장", "type-trip", "project-general", nextWeek(1, 9, 0), false, nextWeek(3, 18, 0))],
  },
  contextSuggestions: [],
};

function scheduleReply(body) {
  const req = readUserRequest(body);
  if (req.includes("출장")) {
    return seoulTrip;
  }
  const base = req.includes("점심") || req.includes("김키포") ? lunchWithKipo : trainingThenReport;
  if (process.env.MOCK_RULES === "1") {
    return { ...base, contextSuggestions: RULE_SUGGESTIONS };
  }
  return base;
}

function qaReply(body) {
  const hasTools = body.includes("표준 필수성") || body.includes("대응논리 초안");
  if (!hasTools) {
    return { answer: "", references: [], toolCalls: [{ tool: "search_notes", args: { keyword: "선행기술조사" } }] };
  }
  return {
    answer:
      "선행기술조사 관련해서는 **선행기술조사 정리** 노트가 있습니다.\n\n- ETSI TS 138 관련 출원 3건 대상\n- 표준 문서 확보·청구항 대조표 작성 완료\n- 대응논리 초안은 아직 남아 있습니다\n\n15일 제출 마감이 있으니 대응논리부터 챙기시면 좋겠어요.",
    references: [
      { type: "note", id: "demo-note-prior-art", title: "선행기술조사 정리" },
      { type: "task", id: "demo-task-08", title: "선행기술조사 결과 제출" },
    ],
    toolCalls: [],
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify({ object: "list", data: [{ id: "demo-model" }] }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    n += 1;
    const isSchedule = body.includes("knownChoices") || body.includes("userRequest");
    const isQa = !isSchedule && (body.includes("noteIndex") || body.includes('"question"'));
    const reply = isQa ? qaReply(body) : scheduleReply(body);
    console.log(`#${n} ${isQa ? "QA" : "SCHEDULE"} -> ${reply.toolCalls?.length ? "toolCalls" : "final"}`);
    const payload = JSON.stringify({
      id: "demo",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(reply) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 180, total_tokens: 1380 },
    });
    // 실제 모델처럼 잠깐 생각하는 시간을 둔다 (녹화 시 진행 상태를 담기 위함)
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(payload);
    }, Number(process.env.MOCK_DELAY_MS ?? 1400));
  });
});

server.listen(3000, "127.0.0.1", () => console.log("demo mock on http://127.0.0.1:3000"));
