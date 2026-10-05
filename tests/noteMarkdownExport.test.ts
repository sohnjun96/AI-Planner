import assert from "node:assert/strict";
import JSZip from "jszip";
import { load } from "js-yaml";
import type { Note, Project, ProjectSubcategory } from "../src/models";
import {
  buildNoteMarkdown,
  createNoteMarkdownFileName,
  createNotesArchive,
  sanitizeNoteExportPathSegment,
} from "../src/utils/noteMarkdownExport";

const project: Project = {
  id: "project-11111111-2222-4333-8444-555555555555",
  name: "특허/프로젝트",
  color: "#2563eb",
  isActive: true,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-22T02:00:00.000Z",
};
const subproject: ProjectSubcategory = {
  id: "subcategory-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  projectId: project.id,
  name: "K-SCAN",
  order: 0,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-22T02:00:00.000Z",
};
const note: Note = {
  id: "note-a3f91c72-b8de-4a5f-9012-3456789abcde",
  title: "AI 특허심사&#x20;",
  content: "---\ncustom_property: 유지\nproject: 이전 프로젝트\n---\nAI 특허심사\n\n- [ ] 검토",
  projectId: project.id,
  subcategoryId: subproject.id,
  tags: ["통합", " 특허 ", "통합"],
  status: "active",
  isPinned: true,
  linkedTaskIds: [],
  createdAt: "2026-08-23T04:50:00.000Z",
  updatedAt: "2026-08-23T05:12:00.000Z",
};

assert.equal(createNoteMarkdownFileName(note), "AI 특허심사--a3f91c72b8de.md");
assert.equal(sanitizeNoteExportPathSegment(" CON ", "없음"), "_CON");
assert.equal(sanitizeNoteExportPathSegment("특허/검토:*?", "없음"), "특허-검토");

const markdown = buildNoteMarkdown(note, project, subproject);
const closingBoundary = markdown.indexOf("\n---\n", 4);
assert.ok(closingBoundary > 0);
const metadata = load(markdown.slice(4, closingBoundary)) as Record<string, unknown>;
assert.equal(metadata.title, "AI 특허심사");
assert.equal(metadata.project, "특허/프로젝트");
assert.equal(metadata.subproject, "K-SCAN");
assert.deepEqual(metadata.tags, ["통합", "특허"]);
assert.equal(metadata.custom_property, "유지");
assert.deepEqual(metadata.planai, {
  note_id: note.id,
  project_id: project.id,
  subproject_id: subproject.id,
});
assert.match(markdown.slice(closingBoundary + 5), /^\nAI 특허심사\n\n- \[ \] 검토\n$/);
assert.equal((markdown.match(/^---$/gm) ?? []).length, 2);

// 분류 해제/프로젝트 이동 후에는 이전 관리 키가 재수출되지 않는다.
// 사용자 프론트매터와 planai 내부의 알 수 없는 사용자 키는 보존한다.
const oldClassificationContent = "---\nsubproject: 이전 항목\ncustom_property: 유지\ncustom_object:\n  nested: true\nplanai:\n  note_id: old-note\n  project_id: old-project\n  subproject_id: old-subproject\n  custom_flag: keep\n---\n본문";
const clearedMarkdown = buildNoteMarkdown({ ...note, content: oldClassificationContent, subcategoryId: undefined }, project);
const clearedMetadata = load(clearedMarkdown.slice(4, clearedMarkdown.indexOf("\n---\n", 4))) as Record<string, unknown>;
assert.equal(Object.hasOwn(clearedMetadata, "subproject"), false);
assert.equal(clearedMetadata.custom_property, "유지");
assert.deepEqual(clearedMetadata.custom_object, { nested: true });
assert.deepEqual(clearedMetadata.planai, { note_id: note.id, project_id: project.id, custom_flag: "keep" });
const wrongProjectMarkdown = buildNoteMarkdown({ ...note, content: oldClassificationContent }, { ...project, id: "project-other" }, { ...subproject, projectId: "project-other" });
const wrongProjectMetadata = load(wrongProjectMarkdown.slice(4, wrongProjectMarkdown.indexOf("\n---\n", 4))) as Record<string, unknown>;
assert.equal(Object.hasOwn(wrongProjectMetadata, "subproject"), false);
assert.equal(Object.hasOwn(wrongProjectMetadata.planai as object, "subproject_id"), false);

const uncategorizedNote: Note = {
  ...note,
  id: "note-0fc21981-a3dc-4b77-8899-aabbccddeeff",
  title: "임시: 메모?",
  content: "본문",
  subcategoryId: undefined,
  tags: [],
  isPinned: false,
};
const archive = await createNotesArchive(
  [note, uncategorizedNote],
  [project],
  [subproject],
  new Date("2026-08-23T13:50:15+09:00"),
);
assert.equal(archive.fileName, "PlanAI-Notes-20260823-135015.zip");
assert.equal(archive.fileCount, 2);
assert.deepEqual(archive.paths, [
  "특허-프로젝트/_세부 프로젝트 없음/임시- 메모--0fc21981a3dc.md",
  "특허-프로젝트/K-SCAN/AI 특허심사--a3f91c72b8de.md",
]);

const zip = await JSZip.loadAsync(new Uint8Array(await archive.blob.arrayBuffer()));
const exportedMarkdown = await zip.file("특허-프로젝트/K-SCAN/AI 특허심사--a3f91c72b8de.md")?.async("string");
assert.equal(exportedMarkdown, markdown);

// 백업의 유효한 ID도 기호/대소문자 정규화 후에는 같은 파일 토큰이 된다.
const collidingNotes = ["note-aa.bb", "note-aabb", "note-AA:BB", "note-AA_BB"].map((id, index) => ({
  ...uncategorizedNote,
  id,
  title: "같은 제목",
  content: `원문 ${index}`,
}));
const collisionArchive = await createNotesArchive(collidingNotes, [project], []);
assert.equal(collisionArchive.fileCount, collidingNotes.length);
assert.equal(new Set(collisionArchive.paths.map((path) => path.toLowerCase())).size, collidingNotes.length);
const collisionZip = await JSZip.loadAsync(new Uint8Array(await collisionArchive.blob.arrayBuffer()));
const collisionFiles = Object.values(collisionZip.files).filter((file) => !file.dir);
assert.equal(collisionFiles.length, collidingNotes.length);
const collisionContents = await Promise.all(collisionFiles.map((file) => file.async("string")));
for (const [index, collisionNote] of collidingNotes.entries()) {
  assert.equal(collisionContents.filter((content) => content.includes(`note_id: "${collisionNote.id}"`) && content.includes(`원문 ${index}`)).length, 1);
}

process.stdout.write("Note Markdown export checks passed.\n");
