export interface MarkdownEditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type MarkdownLineStyle = "heading1" | "heading2" | "heading3" | "bullet" | "ordered" | "checklist" | "quote";

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

  if (task) {
    body = task[4];
    nextPrefix = `${task[1]}${task[2]} [ ] `;
  } else if (ordered) {
    body = ordered[4];
    nextPrefix = `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]} `;
  } else if (bullet) {
    body = bullet[3];
    nextPrefix = `${bullet[1]}${bullet[2]} `;
  } else if (quote) {
    body = quote[2];
    nextPrefix = quote[1];
  } else {
    return null;
  }

  if (!body.trim()) {
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
