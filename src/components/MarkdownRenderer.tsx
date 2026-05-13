import type { ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
}

function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
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
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch?.[2] ?? "";
      nodes.push(
        isSafeUrl(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {label}
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

export function MarkdownRenderer({ content, emptyText = "작성된 메모가 없습니다." }: MarkdownRendererProps) {
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

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      elements.push(
        <pre key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const body = renderInline(headingMatch[2], `heading-${index}`);
      if (level === 1) {
        elements.push(<h1 key={`heading-${index}`}>{body}</h1>);
      } else if (level === 2) {
        elements.push(<h2 key={`heading-${index}`}>{body}</h2>);
      } else {
        elements.push(<h3 key={`heading-${index}`}>{body}</h3>);
      }
      index += 1;
      continue;
    }

    if (/^-\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        const match = candidate.match(/^-\s+\[([ xX])\]\s+(.+)$/);
        if (!match) {
          break;
        }
        const checked = match[1].toLowerCase() === "x";
        items.push(
          <li key={`check-${index}`}>
            <input type="checkbox" checked={checked} readOnly />
            <span>{renderInline(match[2], `check-${index}`)}</span>
          </li>,
        );
        index += 1;
      }
      elements.push(
        <ul key={`check-list-${index}`} className="markdown-checklist">
          {items}
        </ul>,
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        if (!candidate.startsWith("- ")) {
          break;
        }
        items.push(<li key={`list-${index}`}>{renderInline(candidate.slice(2), `list-${index}`)}</li>);
        index += 1;
      }
      elements.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }

    elements.push(<p key={`paragraph-${index}`}>{renderInline(trimmed, `paragraph-${index}`)}</p>);
    index += 1;
  }

  if (elements.length === 0) {
    return <p className="empty-text">{emptyText}</p>;
  }

  return <div className="markdown-renderer">{elements}</div>;
}
