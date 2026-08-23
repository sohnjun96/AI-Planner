export interface MarkdownEditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type MarkdownListShortcut =
  | { kind: "unordered"; body: string }
  | { kind: "ordered"; body: string; start: number }
  | { kind: "checklist"; body: string; checked: boolean };

export function parseMarkdownListShortcut(value: string): MarkdownListShortcut | null {
  const checklist = value.match(/^[-*+][ \u00a0]+\[([ xX])\][ \u00a0]+([^\r\n]*)$/);
  if (checklist) {
    return { kind: "checklist", body: checklist[2], checked: checklist[1].toLowerCase() === "x" };
  }
  const ordered = value.match(/^(\d{1,6})[.)][ \u00a0]+([^\r\n]*)$/);
  if (ordered) {
    return { kind: "ordered", body: ordered[2], start: Math.min(1_000_000, Math.max(1, Number(ordered[1]))) };
  }
  const unordered = value.match(/^[-*+][ \u00a0]+([^\r\n]*)$/);
  return unordered ? { kind: "unordered", body: unordered[1] } : null;
}

export function parseMarkdownChecklistItemShortcut(value: string): { body: string; checked: boolean } | null {
  const match = value.match(/^\[([ xX])\][ \u00a0]+([^\r\n]*)$/);
  return match ? { body: match[2], checked: match[1].toLowerCase() === "x" } : null;
}

export function nextMarkdownListDepth(
  currentDepth: number,
  previousDepth: number | undefined,
  outdent: boolean,
  maxDepth = 4,
): number {
  const safeMax = Math.min(8, Math.max(1, Math.trunc(maxDepth) || 4));
  const current = Math.min(safeMax, Math.max(0, Math.trunc(currentDepth) || 0));
  if (outdent) return Math.max(0, current - 1);
  if (previousDepth === undefined) return current;
  const previous = Math.min(safeMax, Math.max(0, Math.trunc(previousDepth) || 0));
  return Math.min(safeMax, current + 1, previous + 1);
}

export type MarkdownLineStyle = "heading1" | "heading2" | "heading3" | "bullet" | "ordered" | "checklist" | "quote";

const MARKDOWN_SPACE_ENTITY = /&(?:#x0*20|#0*32|nbsp);/gi;

function decodeSpaceEntitiesOutsideInlineCode(line: string): string {
  let result = "";
  let cursor = 0;
  let inlineFenceLength = 0;

  while (cursor < line.length) {
    const nextBacktick = line.indexOf("`", cursor);
    const textEnd = nextBacktick < 0 ? line.length : nextBacktick;
    const text = line.slice(cursor, textEnd);
    result += inlineFenceLength === 0 ? text.replace(MARKDOWN_SPACE_ENTITY, " ") : text;
    if (nextBacktick < 0) break;

    let runEnd = nextBacktick + 1;
    while (line[runEnd] === "`") runEnd += 1;
    const run = line.slice(nextBacktick, runEnd);
    result += run;
    if (inlineFenceLength === 0) inlineFenceLength = run.length;
    else if (inlineFenceLength === run.length) inlineFenceLength = 0;
    cursor = runEnd;
  }

  return result;
}

/**
 * 라이브 편집기의 Markdown 직렬화 과정에서 생기는 공백 문자 참조를 일반 공백으로 되돌린다.
 * 사용자가 실제 문자 참조를 작성할 수 있는 인라인 코드와 fenced code block은 그대로 보존한다.
 */
export function normalizeLiveMarkdownWhitespace(value: string): string {
  const parts = value.split(/(\r\n|\r|\n)/);
  let fencedCharacter = "";
  let fencedLength = 0;

  return parts
    .map((part) => {
      if (/^\r?\n$|^\r$/.test(part)) return part;

      const fence = part.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fencedCharacter) {
        if (
          fence &&
          fence[1][0] === fencedCharacter &&
          fence[1].length >= fencedLength &&
          fence[2].trim() === ""
        ) {
          fencedCharacter = "";
          fencedLength = 0;
        }
        return part;
      }

      if (fence) {
        fencedCharacter = fence[1][0];
        fencedLength = fence[1].length;
        return part;
      }

      return decodeSpaceEntitiesOutsideInlineCode(part);
    })
    .join("");
}

function replaceRange(value: string, start: number, end: number, replacement: string, selectionOffset = replacement.length): MarkdownEditResult {
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart: start + selectionOffset,
    selectionEnd: start + selectionOffset,
  };
}

function selectedLineRange(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = value.indexOf("\n", end);
  const lineEnd = nextNewline < 0 ? value.length : nextNewline;
  return { lineStart, lineEnd };
}

export function wrapMarkdownSelection(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): MarkdownEditResult {
  const selected = value.slice(start, end) || placeholder;
  const replacement = `${prefix}${selected}${suffix}`;
  const selectionStart = start + prefix.length;
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}

export function toggleMarkdownSelection(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): MarkdownEditResult {
  if (
    start >= prefix.length &&
    value.slice(start - prefix.length, start) === prefix &&
    value.slice(end, end + suffix.length) === suffix
  ) {
    return {
      value: value.slice(0, start - prefix.length) + value.slice(start, end) + value.slice(end + suffix.length),
      selectionStart: start - prefix.length,
      selectionEnd: end - prefix.length,
    };
  }

  const selected = value.slice(start, end);
  if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
    const body = selected.slice(prefix.length, selected.length - suffix.length);
    return {
      value: value.slice(0, start) + body + value.slice(end),
      selectionStart: start,
      selectionEnd: start + body.length,
    };
  }

  return wrapMarkdownSelection(value, start, end, prefix, suffix, placeholder);
}

export function insertMarkdownLink(
  value: string,
  start: number,
  end: number,
  href: string,
  placeholder = "링크 텍스트",
): MarkdownEditResult {
  const selected = value.slice(start, end) || placeholder;
  const replacement = `[${selected}](${href})`;
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart: start + 1,
    selectionEnd: start + 1 + selected.length,
  };
}

function stripBlockPrefix(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}\s+/, "$1")
    .replace(/^(\s*)>\s?/, "$1")
    .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1")
    .replace(/^(\s*)[-*+]\s+/, "$1")
    .replace(/^(\s*)\d+[.)]\s+/, "$1");
}

export function applyMarkdownLineStyle(
  value: string,
  start: number,
  end: number,
  style: MarkdownLineStyle,
): MarkdownEditResult {
  const { lineStart, lineEnd } = selectedLineRange(value, start, end);
  const original = value.slice(lineStart, lineEnd);
  const lines = original.split("\n");
  const stylePattern: Record<MarkdownLineStyle, RegExp> = {
    heading1: /^(\s*)#\s+/,
    heading2: /^(\s*)##\s+/,
    heading3: /^(\s*)###\s+/,
    bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\])/,
    ordered: /^(\s*)\d+[.)]\s+/,
    checklist: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
    quote: /^(\s*)>\s?/,
  };
  const removeStyle = lines.every((line) => !line.trim() || stylePattern[style].test(line));
  let order = 1;
  const transformed = lines.map((line) => {
    if (!line.trim()) return line;
    if (removeStyle) return line.replace(stylePattern[style], "$1");
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const body = stripBlockPrefix(line).slice(indent.length);
    switch (style) {
      case "heading1":
        return `${indent}# ${body}`;
      case "heading2":
        return `${indent}## ${body}`;
      case "heading3":
        return `${indent}### ${body}`;
      case "bullet":
        return `${indent}- ${body}`;
      case "ordered":
        return `${indent}${order++}. ${body}`;
      case "checklist":
        return `${indent}- [ ] ${body}`;
      case "quote":
        return `${indent}> ${body}`;
    }
  });
  const replacement = transformed.join("\n");
  return {
    value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

export function indentMarkdownLines(value: string, start: number, end: number, outdent: boolean): MarkdownEditResult {
  const { lineStart, lineEnd } = selectedLineRange(value, start, end);
  const original = value.slice(lineStart, lineEnd);
  const transformed = original
    .split("\n")
    .map((line) => (outdent ? line.replace(/^( {1,2}|\t)/, "") : line ? `  ${line}` : line))
    .join("\n");
  return {
    value: value.slice(0, lineStart) + transformed + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + transformed.length,
  };
}

export function continueMarkdownLine(value: string, start: number, end: number): MarkdownEditResult | null {
  if (start !== end) return null;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);

  const task = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s*(.*)$/);
  const ordered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
  const quote = line.match(/^(\s*>\s?)(.*)$/);
  let body = "";
  let nextPrefix = "";
  let indent = "";

  if (task) {
    body = task[4];
    indent = task[1];
    nextPrefix = `${task[1]}${task[2]} [ ] `;
  } else if (ordered) {
    body = ordered[4];
    indent = ordered[1];
    nextPrefix = `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `;
  } else if (bullet) {
    body = bullet[3];
    indent = bullet[1];
    nextPrefix = `${bullet[1]}${bullet[2]} `;
  } else if (quote) {
    body = quote[2];
    nextPrefix = quote[1];
  } else {
    return null;
  }

  if (!body.trim()) {
    if (indent) {
      const outdentedIndent = indent.replace(/(?: {1,2}|\t)$/, "");
      const marker = nextPrefix.slice(indent.length);
      return replaceRange(value, lineStart, lineEnd, `${outdentedIndent}${marker}`);
    }
    return replaceRange(value, lineStart, lineEnd, "", 0);
  }

  return replaceRange(value, start, start, `\n${nextPrefix}`);
}

export function removeEmptyMarkdownPrefix(value: string, cursor: number): MarkdownEditResult | null {
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const beforeCursor = value.slice(lineStart, cursor);
  if (!/^(\s*)(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+[.)]\s+|>\s?)$/.test(beforeCursor)) return null;
  return replaceRange(value, lineStart, cursor, "", 0);
}

export function insertMarkdownTable(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end).trim();
  const firstCell = selected || "항목";
  const table = `| ${firstCell} | 내용 |\n| --- | --- |\n| 값 | 값 |`;
  const needsLeadingBreak = start > 0 && value[start - 1] !== "\n";
  const needsTrailingBreak = end < value.length && value[end] !== "\n";
  const replacement = `${needsLeadingBreak ? "\n\n" : ""}${table}${needsTrailingBreak ? "\n\n" : ""}`;
  const cellStart = start + (needsLeadingBreak ? 2 : 0) + 2;
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart: cellStart,
    selectionEnd: cellStart + firstCell.length,
  };
}

export interface MarkdownSlashCommandDefinition {
  id: string;
  label: string;
  description: string;
  keywords: string;
}

export function filterMarkdownSlashCommands<T extends MarkdownSlashCommandDefinition>(
  commands: readonly T[],
  query: string,
  limit = 10,
): T[] {
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit) || 10));
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").slice(0, 24);
  if (!normalizedQuery) return commands.slice(0, safeLimit);
  return commands
    .filter((command) => `${command.label} ${command.description} ${command.keywords}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    .slice(0, safeLimit);
}
