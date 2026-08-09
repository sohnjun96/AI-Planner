import type { ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
  checklistDisabled?: boolean;
  checklistUncontrolled?: boolean;
  onChecklistToggle?: (lineIndex: number, checked: boolean) => void;
}

function toSafeExternalUrl(value: string): string | undefined {
  if (value.length > 2_048 || Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "mailto:") return parsed.href;
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password
    ) {
      return parsed.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// 인라인: 코드, 볼드, 이탤릭, 취소선, 하이라이트, 링크와 이미지 링크
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|==[^=]+==|\*[^*]+\*|_[^_]+_|!?\[[^\]]+\]\([^)]+\)|<(?:https?:\/\/|mailto:)[^>]+>)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("==")) {
      nodes.push(<mark key={key}>{token.slice(2, -2)}</mark>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("<")) {
      const label = token.slice(1, -1);
      const safeHref = toSafeExternalUrl(label);
      nodes.push(
        safeHref ? (
          <a key={key} href={safeHref} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      const image = token.startsWith("!");
      const linkMatch = token.match(/^!?\[([^\]]+)\]\(([^)]+)\)$/);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch?.[2] ?? "";
      const safeHref = toSafeExternalUrl(href);
      nodes.push(
        safeHref ? (
          <a key={key} className={image ? "markdown-image-link" : undefined} href={safeHref} target="_blank" rel="noreferrer">
            {image ? `이미지: ${label}` : label}
          </a>
        ) : (
          label
        ),
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      cell += character;
    } else if (character === "|") {
      cells.push(cell.trim().replace(/\\\|/g, "|"));
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim().replace(/\\\|/g, "|"));
  return cells;
}

function tableAlignments(line: string): Array<"left" | "center" | "right"> | null {
  const cells = splitTableRow(line);
  if (cells.length === 0 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"));
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim() ?? "";
  const divider = lines[index + 1]?.trim() ?? "";
  return header.includes("|") && divider.includes("|") && tableAlignments(divider) !== null;
}

function leadingIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  const spaces = match ? match[1].replace(/\t/g, "  ").length : 0;
  return Math.min(4, Math.floor(spaces / 2));
}

export function MarkdownRenderer({
  content,
  emptyText = "작성된 메모가 없습니다.",
  checklistDisabled = false,
  checklistUncontrolled = false,
  onChecklistToggle,
}: MarkdownRendererProps) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // 코드 펜스
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const fenceKey = index;
      const language = trimmed.slice(3).trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      elements.push(
        <pre key={`code-${fenceKey}`}>
          <code className={language ? `language-${language}` : undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // GitHub Flavored Markdown 표
    if (isTableStart(lines, index)) {
      const tableKey = index;
      const headers = splitTableRow(lines[index] ?? "");
      const alignments = tableAlignments(lines[index + 1] ?? "") ?? headers.map(() => "left" as const);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").trim() && (lines[index] ?? "").includes("|")) {
        rows.push(splitTableRow(lines[index] ?? ""));
        index += 1;
      }
      elements.push(
        <div key={`table-${tableKey}`} className="markdown-table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((header, columnIndex) => (
                  <th key={`th-${columnIndex}`} style={{ textAlign: alignments[columnIndex] ?? "left" }}>
                    {renderInline(header, `table-${tableKey}-head-${columnIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`}>
                  {headers.map((_, columnIndex) => (
                    <td key={`td-${rowIndex}-${columnIndex}`} style={{ textAlign: alignments[columnIndex] ?? "left" }}>
                      {renderInline(row[columnIndex] ?? "", `table-${tableKey}-${rowIndex}-${columnIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 구분선
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      elements.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    // 제목 h1~h6
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const body = renderInline(headingMatch[2], `heading-${index}`);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      elements.push(<Tag key={`heading-${index}`}>{body}</Tag>);
      index += 1;
      continue;
    }

    // 인용
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      elements.push(
        <blockquote key={`quote-${index}`}>{renderInline(quoteLines.join(" "), `quote-${index}`)}</blockquote>,
      );
      continue;
    }

    // 체크리스트
    if (/^[-*+]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      const listKey = index;
      while (index < lines.length) {
        const raw = lines[index] ?? "";
        const candidate = raw.trim();
        const match = candidate.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
        if (!match) {
          break;
        }
        const checked = match[1].toLowerCase() === "x";
        const lineIndex = index;
        const indent = leadingIndent(raw);
        items.push(
          <li key={`check-${index}`} className={checked ? "checked" : ""} style={indent ? { marginLeft: indent * 16 } : undefined}>
            <input
              type="checkbox"
              checked={checklistUncontrolled ? undefined : checked}
              defaultChecked={checklistUncontrolled ? checked : undefined}
              disabled={checklistDisabled}
              onChange={(event) => onChecklistToggle?.(lineIndex, event.target.checked)}
            />
            <span>{renderInline(match[2], `check-${index}`)}</span>
          </li>,
        );
        index += 1;
      }
      elements.push(
        <ul key={`check-list-${listKey}`} className="markdown-checklist">
          {items}
        </ul>,
      );
      continue;
    }

    // 순서 목록
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      const listKey = index;
      while (index < lines.length) {
        const raw = lines[index] ?? "";
        const candidate = raw.trim();
        const match = candidate.match(/^\d+[.)]\s+(.+)$/);
        if (!match) {
          break;
        }
        const indent = leadingIndent(raw);
        items.push(
          <li key={`ol-${index}`} style={indent ? { marginLeft: indent * 16 } : undefined}>
            {renderInline(match[1], `ol-${index}`)}
          </li>,
        );
        index += 1;
      }
      elements.push(<ol key={`ol-list-${listKey}`}>{items}</ol>);
      continue;
    }

    // 불릿 목록
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      const listKey = index;
      while (index < lines.length) {
        const raw = lines[index] ?? "";
        const candidate = raw.trim();
        const match = candidate.match(/^[-*+]\s+(.+)$/);
        if (!match || /^[-*+]\s+\[[ xX]\]\s+/.test(candidate)) {
          break;
        }
        const indent = leadingIndent(raw);
        items.push(
          <li key={`list-${index}`} style={indent ? { marginLeft: indent * 16 } : undefined}>
            {renderInline(match[1], `list-${index}`)}
          </li>,
        );
        index += 1;
      }
      elements.push(<ul key={`list-${listKey}`}>{items}</ul>);
      continue;
    }

    // 문단 (연속된 일반 줄 묶기)
    const paragraphLines: string[] = [trimmed];
    const paraKey = index;
    index += 1;
    while (index < lines.length) {
      const raw = lines[index] ?? "";
      const candidate = raw.trim();
      if (
        !candidate ||
        candidate.startsWith("```") ||
        candidate.startsWith(">") ||
        candidate.startsWith("#") ||
        /^[-*+]\s+/.test(candidate) ||
        /^\d+[.)]\s+/.test(candidate) ||
        /^([-*_])\1{2,}$/.test(candidate) ||
        isTableStart(lines, index)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }
    elements.push(<p key={`paragraph-${paraKey}`}>{renderInline(paragraphLines.join("\n"), `paragraph-${paraKey}`)}</p>);
  }

  if (elements.length === 0) {
    return <p className="empty-text">{emptyText}</p>;
  }

  return <div className="markdown-renderer">{elements}</div>;
}
