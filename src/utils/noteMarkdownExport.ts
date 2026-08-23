import JSZip from "jszip";
import { CORE_SCHEMA, dump, load } from "js-yaml";
import type { Note, Project, ProjectSubcategory } from "../models";
import { decodeMarkdownHtmlEntities } from "./noteTitle";

const NOTE_ID_SUFFIX_LENGTH = 12;
const MAX_NOTE_FILE_TITLE_LENGTH = 80;
const MAX_FOLDER_NAME_LENGTH = 48;
const MAX_NOTES_EXPORT_SOURCE_BYTES = 200_000_000;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FRONTMATTER_BOUNDARY = /^(---|\.\.\.)[ \t]*$/;
const YAML_REFERENCE_TOKEN = /(?:^|[\s:[{,])[*&][a-z0-9_-]+/i;

interface LeadingFrontmatter {
  metadata: Record<string, unknown>;
  body: string;
}

export interface NotesArchiveResult {
  blob: Blob;
  fileName: string;
  fileCount: number;
  paths: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("");
}

function normalizeNoteTitle(value: string): string {
  const title = replaceControlCharacters(decodeMarkdownHtmlEntities(value))
    .replace(/\s+/g, " ")
    .trim();
  return title || "제목 없는 노트";
}

function limitCharacters(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length <= maxLength ? value : characters.slice(0, maxLength).join("").trimEnd();
}

/** Windows/macOS에서 안전하며 ZIP 해제 후에도 경로가 지나치게 길어지지 않는 이름을 만든다. */
export function sanitizeNoteExportPathSegment(value: string, fallback: string, maxLength = MAX_FOLDER_NAME_LENGTH): string {
  let segment = replaceControlCharacters(decodeMarkdownHtmlEntities(value))
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/[-. ]+$/g, "");

  segment = limitCharacters(segment, maxLength).replace(/[-. ]+$/g, "");
  if (!segment) segment = fallback;
  if (WINDOWS_RESERVED_NAME.test(segment)) segment = `_${segment}`;
  return segment;
}

function stableIdToken(id: string, length = NOTE_ID_SUFFIX_LENGTH): string {
  const withoutPrefix = id.replace(/^[a-z]+-/i, "");
  const compact = withoutPrefix.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en-US");
  if (compact) return compact.slice(0, length);

  // 현재 데이터는 UUID이지만, 과거/가져온 비표준 ID도 결정적인 파일명을 갖도록 한다.
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, "0");
}

export function createNoteMarkdownFileName(note: Pick<Note, "id" | "title">): string {
  const title = sanitizeNoteExportPathSegment(normalizeNoteTitle(note.title), "제목 없는 노트", MAX_NOTE_FILE_TITLE_LENGTH);
  return `${title}--${stableIdToken(note.id)}.md`;
}

function parseLeadingFrontmatter(content: string): LeadingFrontmatter | undefined {
  const normalized = normalizeLineEndings(content).replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;

  let closingLine = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_BOUNDARY.test(lines[index] ?? "")) {
      closingLine = index;
      break;
    }
  }
  if (closingLine < 0) return undefined;

  const source = lines.slice(1, closingLine).join("\n");
  // 사용자가 작성한 프론트매터의 별칭/앵커 확장은 과도한 메모리 사용을 일으킬 수 있어 병합 대상에서 제외한다.
  if (YAML_REFERENCE_TOKEN.test(source)) return undefined;
  let parsed: unknown;
  try {
    parsed = load(source, { schema: CORE_SCHEMA });
  } catch {
    return undefined;
  }
  if (!isPlainRecord(parsed)) return undefined;
  return {
    metadata: parsed,
    body: lines.slice(closingLine + 1).join("\n").replace(/^\n/, ""),
  };
}

function toExportTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function buildGeneratedMetadata(note: Note, project?: Project, subproject?: ProjectSubcategory): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    title: normalizeNoteTitle(note.title),
    project: project?.name ?? "프로젝트 없음",
  };
  if (subproject && subproject.projectId === note.projectId) {
    metadata.subproject = subproject.name;
  }
  metadata.tags = Array.from(new Set(note.tags.map((tag) => tag.trim()).filter(Boolean)));
  metadata.status = note.status;
  metadata.pinned = note.isPinned;
  metadata.created_at = toExportTimestamp(note.createdAt);
  metadata.updated_at = toExportTimestamp(note.updatedAt);

  const planai: Record<string, string> = {
    note_id: note.id,
    project_id: note.projectId,
  };
  if (subproject && subproject.projectId === note.projectId) {
    planai.subproject_id = subproject.id;
  }
  metadata.planai = planai;
  return metadata;
}

/** 기존 사용자 프론트매터의 알 수 없는 키는 보존하고 PlanAI 관리 키만 최신 값으로 덮어쓴다. */
export function buildNoteMarkdown(note: Note, project?: Project, subproject?: ProjectSubcategory): string {
  const normalizedContent = normalizeLineEndings(note.content).replace(/^\uFEFF/, "");
  const existing = parseLeadingFrontmatter(normalizedContent);
  const generated = buildGeneratedMetadata(note, project, subproject);
  const existingPlanai = isPlainRecord(existing?.metadata.planai) ? existing.metadata.planai : {};
  const metadata = {
    ...(existing?.metadata ?? {}),
    ...generated,
    planai: {
      ...existingPlanai,
      ...(generated.planai as Record<string, unknown>),
    },
  };
  const yaml = dump(metadata, {
    lineWidth: -1,
    noRefs: true,
    noCompatMode: true,
    quotingType: '"',
    forceQuotes: true,
  }).trimEnd();
  const body = existing?.body ?? normalizedContent;
  return `---\n${yaml}\n---\n${body ? `\n${body.replace(/^\n+/, "")}` : ""}\n`;
}

function createFolderNames<T extends { id: string; name: string }>(
  items: T[],
  groupKey: (item: T) => string,
): Map<string, string> {
  const baseById = new Map<string, string>();
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const base = sanitizeNoteExportPathSegment(item.name, "이름 없음");
    baseById.set(item.id, base);
    const key = `${groupKey(item)}\u0000${base.toLocaleLowerCase("en-US")}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const result = new Map<string, string>();
  for (const group of grouped.values()) {
    for (const item of group) {
      const base = baseById.get(item.id) ?? "이름 없음";
      result.set(item.id, group.length > 1 ? `${base}--${stableIdToken(item.id)}` : base);
    }
  }
  return result;
}

function createArchiveFileName(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `PlanAI-Notes-${year}${month}${day}-${hour}${minute}${second}.zip`;
}

export async function createNotesArchive(
  notes: Note[],
  projects: Project[],
  subprojects: ProjectSubcategory[],
  now = new Date(),
): Promise<NotesArchiveResult> {
  if (notes.length === 0) throw new Error("내보낼 노트가 없습니다.");

  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const subprojectMap = new Map(subprojects.map((subproject) => [subproject.id, subproject]));
  const projectFolderMap = createFolderNames(projects, () => "projects");
  const subprojectFolderMap = createFolderNames(subprojects, (subproject) => subproject.projectId);
  const zip = new JSZip();
  const paths: string[] = [];
  const usedPaths = new Set<string>();
  let sourceBytes = 0;

  const sortedNotes = [...notes].sort((left, right) => {
    const projectCompare = left.projectId.localeCompare(right.projectId, "ko");
    if (projectCompare !== 0) return projectCompare;
    const subprojectCompare = (left.subcategoryId ?? "").localeCompare(right.subcategoryId ?? "", "ko");
    if (subprojectCompare !== 0) return subprojectCompare;
    return normalizeNoteTitle(left.title).localeCompare(normalizeNoteTitle(right.title), "ko");
  });

  for (const note of sortedNotes) {
    const project = projectMap.get(note.projectId);
    const subproject = note.subcategoryId ? subprojectMap.get(note.subcategoryId) : undefined;
    const projectFolder = project
      ? projectFolderMap.get(project.id) ?? sanitizeNoteExportPathSegment(project.name, "프로젝트 없음")
      : `_프로젝트 없음--${stableIdToken(note.projectId)}`;
    const subprojectFolder =
      subproject && subproject.projectId === note.projectId
        ? subprojectFolderMap.get(subproject.id) ?? sanitizeNoteExportPathSegment(subproject.name, "세부 프로젝트 없음")
        : "_세부 프로젝트 없음";
    const markdown = buildNoteMarkdown(note, project, subproject);
    sourceBytes += new TextEncoder().encode(markdown).byteLength;
    if (sourceBytes > MAX_NOTES_EXPORT_SOURCE_BYTES) {
      throw new Error("노트 내보내기 데이터가 안전한 처리 한도(200MB)를 초과했습니다.");
    }

    let fileName = createNoteMarkdownFileName(note);
    let path = `${projectFolder}/${subprojectFolder}/${fileName}`;
    const collisionKey = path.toLocaleLowerCase("en-US");
    if (usedPaths.has(collisionKey)) {
      const title = sanitizeNoteExportPathSegment(normalizeNoteTitle(note.title), "제목 없는 노트", MAX_NOTE_FILE_TITLE_LENGTH);
      fileName = `${title}--${stableIdToken(note.id, 32)}.md`;
      path = `${projectFolder}/${subprojectFolder}/${fileName}`;
    }
    usedPaths.add(path.toLocaleLowerCase("en-US"));
    paths.push(path);
    zip.file(path, markdown, { date: new Date(note.updatedAt) });
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "DOS",
  });
  return { blob, fileName: createArchiveFileName(now), fileCount: paths.length, paths };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function downloadNoteMarkdown(note: Note, project?: Project, subproject?: ProjectSubcategory): string {
  const fileName = createNoteMarkdownFileName(note);
  downloadBlob(new Blob([buildNoteMarkdown(note, project, subproject)], { type: "text/markdown;charset=utf-8" }), fileName);
  return fileName;
}

export async function downloadNotesArchive(
  notes: Note[],
  projects: Project[],
  subprojects: ProjectSubcategory[],
): Promise<NotesArchiveResult> {
  const result = await createNotesArchive(notes, projects, subprojects);
  downloadBlob(result.blob, result.fileName);
  return result;
}
