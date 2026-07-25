// 데모/스크린샷용 목업 데이터 생성기
//
//   node docs/demo-seed.mjs
//
// 두 파일을 만든다.
//   docs/demo-seed.json  — 앱의 "설정 → JSON 가져오기"로 바로 불러올 수 있는 백업 형식
//   docs/demo-seed.dom.js — 브라우저 콘솔/자동화에서 IndexedDB에 직접 넣는 스크립트
//
// 날짜는 실행한 달을 기준으로 계산하므로 언제 돌려도 달력이 채워진다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth();
const nowIso = now.toISOString();

/** 이번 달 d일 h시 mi분의 ISO 문자열 */
const at = (d, h, mi = 0) => new Date(Y, M, d, h, mi).toISOString();

// ---------- 프로젝트 ----------
// project-general / project-lunch 는 앱 기본 프로젝트 id라 이름만 바꿔 재사용한다.
const projects = [
  { id: "project-general", name: "분류", color: "#3b82f6", description: "출원 분류와 IPC 재분류", order: 0 },
  { id: "project-prior-art", name: "선행기술조사", color: "#8b5cf6", description: "선행문헌 조사와 대응 논리", order: 1 },
  { id: "project-ai", name: "특허심사 AI", color: "#0ea5e9", description: "심사 지원 AI 도입과 실증", order: 2 },
  { id: "project-report", name: "보고", color: "#f59e0b", description: "실적 취합과 정기 보고", order: 3 },
  { id: "project-lunch", name: "저녁 약속", color: "#14b8a6", description: "식사·회식 약속", order: 4 },
].map((p) => ({ ...p, isActive: true, createdAt: nowIso, updatedAt: nowIso }));

// ---------- 일정 ----------
// [일, 시, 분, 제목, 종류, 프로젝트, 상태, 중요?]
const taskRows = [
  // 분류
  [1, 10, 0, "전월 이월 분류 정리", "type-write", "project-general", "DONE", false],
  [2, 9, 0, "A출원 분류 검토", "type-write", "project-general", "DONE", false],
  [6, 15, 0, "IPC 재분류 작업", "type-write", "project-general", "NOT_DONE", false],
  [20, 14, 0, "분류 품질 점검 회의", "type-meeting", "project-general", "NOT_DONE", false],

  // 선행기술조사
  [3, 14, 0, "선행기술조사 착수 회의", "type-meeting", "project-prior-art", "DONE", true],
  [6, 16, 0, "B출원 선행문헌 검토", "type-write", "project-prior-art", "NOT_DONE", false],
  [6, 17, 0, "C출원 조사 검토", "type-write", "project-prior-art", "ON_HOLD", false],
  [15, 14, 0, "선행기술조사 결과 제출", "type-submit", "project-prior-art", "NOT_DONE", true],

  // 특허심사 AI
  [6, 10, 0, "심사관 협의", "type-meeting", "project-ai", "NOT_DONE", true],
  [9, 15, 0, "특허심사 AI 세미나", "type-event", "project-ai", "NOT_DONE", false],
  [17, 13, 0, "대전 출장 · AI 실증", "type-trip", "project-ai", "NOT_DONE", false],

  // 보고
  [6, 9, 0, "주간 자료 취합", "type-write", "project-report", "DONE", false],
  [8, 9, 30, "월간 실적 보고", "type-report", "project-report", "NOT_DONE", true],
  [22, 16, 0, "분기 리뷰 자료 제출", "type-submit", "project-report", "NOT_DONE", true],

  // 저녁 약속
  [6, 12, 0, "OOO 심사관과 점심", "type-meal", "project-lunch", "NOT_DONE", false],
  [10, 18, 30, "팀 저녁 회식", "type-meal", "project-lunch", "NOT_DONE", false],

  // 교육 이수
  [7, 10, 0, "심사실무 교육 이수", "type-event", "project-general", "NOT_DONE", false],
  [13, 14, 0, "AI 활용 교육 이수", "type-event", "project-ai", "NOT_DONE", false],
  [24, 9, 0, "청렴 교육 이수", "type-event", "project-general", "NOT_DONE", true],

  // 연가
  [14, 9, 0, "연가", "type-leave", "project-general", "NOT_DONE", false],
  [27, 9, 0, "연가 (하계휴가)", "type-leave", "project-general", "NOT_DONE", false],
  [28, 9, 0, "연가 (하계휴가)", "type-leave", "project-general", "NOT_DONE", false],
];

const tasks = taskRows.map(([d, h, mi, title, taskTypeId, projectId, status, isMajor], index) => ({
  id: `demo-task-${String(index + 1).padStart(2, "0")}`,
  title,
  content: "",
  taskTypeId,
  projectId,
  status,
  startAt: at(d, h, mi),
  isMajor,
  createdAt: nowIso,
  updatedAt: nowIso,
  ...(status === "DONE" ? { completedAt: nowIso } : {}),
}));

// ---------- 노트 ----------
const noteRows = [
  {
    id: "demo-note-prior-art",
    title: "선행기술조사 정리",
    projectId: "project-prior-art",
    tags: ["선행조사", "대응논리"],
    isPinned: true,
    content: `# 선행기술조사 정리

## 대상
- ETSI TS 138 관련 출원 3건

## 진행 상황
- [x] 표준 문서 확보
- [x] 청구항 대조표 작성
- [ ] 대응논리 초안
- [ ] 협의 안건 정리

> **핵심**: 표준 필수성 판단이 쟁점. 15일 제출 마감 준수 필요.`,
  },
  {
    id: "demo-note-consult",
    title: "심사관 협의 준비 메모",
    projectId: "project-ai",
    tags: ["협의", "심사"],
    isPinned: false,
    content: `# 심사관 협의 준비

## 안건
1. A출원 진보성 판단 기준
2. B출원 명세서 기재불비

## 준비물
- [ ] 인용문헌 요약본
- [ ] 비교표 출력
- [x] 회의실 예약`,
  },
  {
    id: "demo-note-training",
    title: "교육 이수 계획",
    projectId: "project-general",
    tags: ["교육"],
    isPinned: false,
    content: `# 올해 교육 이수 계획

- [x] 심사실무 기본 (3월)
- [ ] 심사실무 교육 — 7일
- [ ] AI 활용 교육 — 13일
- [ ] 청렴 교육 — 24일

> 연말까지 총 40시간 이수 필요. 현재 22시간.`,
  },
  {
    id: "demo-note-report",
    title: "월간 실적 보고 초안",
    projectId: "project-report",
    tags: ["보고"],
    isPinned: false,
    content: `# 실적 보고 초안

## 처리 현황
- 분류 처리 **32건**
- 선행기술조사 **12건**
- 의견제출통지 **8건**

## 특이사항
특허심사 AI 실증 참여로 조사 소요시간 단축.`,
  },
];

const notes = noteRows.map((n, index) => ({
  ...n,
  status: "active",
  linkedTaskIds: [],
  sortOrder: index,
  createdAt: new Date(Date.now() - (index + 1) * 3600_000).toISOString(),
  updatedAt: new Date(Date.now() - (index + 1) * 3600_000).toISOString(),
}));

// ---------- 산출물 ----------
// 앱 가져오기 형식(version 3). taskTypes·settings 등은 앱 기본값을 유지하려고 비워 둔다.
const backup = {
  exportedAt: nowIso,
  version: 3,
  tasks,
  projects,
  taskTypes: [],
  memos: [],
  settings: [],
  userContexts: [],
  notes,
  noteVersions: [],
  noteTaskLinks: [],
  projectSubcategories: [],
};

fs.writeFileSync(path.join(__dirname, "demo-seed.json"), JSON.stringify(backup, null, 2));

// IndexedDB 직접 주입용 (스크린샷 자동화에서 사용)
const domScript = `// 자동 생성 — docs/demo-seed.mjs
new Promise((resolve) => {
  const PROJECTS = ${JSON.stringify(projects)};
  const TASKS = ${JSON.stringify(tasks)};
  const NOTES = ${JSON.stringify(notes)};
  const req = indexedDB.open("schedule-manager-db");
  req.onerror = () => resolve("open failed");
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(["projects", "tasks", "notes"], "readwrite");
    const ps = tx.objectStore("projects");
    const ts = tx.objectStore("tasks");
    const ns = tx.objectStore("notes");
    ts.clear();
    ns.clear();
    PROJECTS.forEach((p) => ps.put(p));
    TASKS.forEach((t) => ts.put(t));
    NOTES.forEach((n) => ns.put(n));
    tx.oncomplete = () => {
      db.close();
      resolve("seeded projects=" + PROJECTS.length + " tasks=" + TASKS.length + " notes=" + NOTES.length);
    };
    tx.onerror = () => resolve("tx error: " + tx.error);
  };
})
`;
fs.writeFileSync(path.join(__dirname, "demo-seed.dom.js"), domScript);

console.log(`demo-seed.json / demo-seed.dom.js written — projects=${projects.length} tasks=${tasks.length} notes=${notes.length}`);
