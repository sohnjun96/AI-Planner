import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import {
  applyMarkdownLineStyle,
  continueMarkdownLine,
  indentMarkdownLines,
  insertMarkdownLink,
  insertMarkdownTable,
  removeEmptyMarkdownPrefix,
  toggleMarkdownSelection,
  type MarkdownEditResult,
  type MarkdownLineStyle,
} from "../utils/markdownEditing";

interface MarkdownComposerProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onContextMenu?: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onDone?: () => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
  autoFocus?: boolean;
  onSelectionChange?: (start: number, end: number) => void;
}

interface ToolbarAction {
  id: string;
  label: string;
  title: string;
  run: () => void;
}

export function MarkdownComposer({
  value,
  onChange,
  textareaRef,
  onContextMenu,
  onDone,
  placeholder = "내용을 입력하세요.",
  rows = 18,
  compact = false,
  autoFocus = false,
  onSelectionChange,
}: MarkdownComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) {
      localRef.current?.focus();
    }
  }, [autoFocus]);

  function selection() {
    const textarea = localRef.current;
    return {
      start: textarea?.selectionStart ?? value.length,
      end: textarea?.selectionEnd ?? value.length,
    };
  }

  function applyEdit(result: MarkdownEditResult) {
    onChange(result.value);
    window.requestAnimationFrame(() => {
      const textarea = localRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      onSelectionChange?.(result.selectionStart, result.selectionEnd);
    });
  }

  function wrap(prefix: string, suffix: string, placeholderText: string) {
    const { start, end } = selection();
    applyEdit(toggleMarkdownSelection(value, start, end, prefix, suffix, placeholderText));
  }

  function insertLink() {
    const href = window.prompt("링크 주소를 입력하세요. (http, https, mailto)", "https://")?.trim();
    if (!href) return;
    try {
      const parsed = new URL(href);
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol) || parsed.username || parsed.password) return;
    } catch {
      return;
    }
    const { start, end } = selection();
    applyEdit(insertMarkdownLink(value, start, end, href));
  }

  function lineStyle(style: MarkdownLineStyle) {
    const { start, end } = selection();
    applyEdit(applyMarkdownLineStyle(value, start, end, style));
  }

  function insertCodeBlock() {
    const { start, end } = selection();
    const selected = value.slice(start, end) || "코드";
    const replacement = `\`\`\`\n${selected}\n\`\`\``;
    applyEdit({
      value: value.slice(0, start) + replacement + value.slice(end),
      selectionStart: start + 4,
      selectionEnd: start + 4 + selected.length,
    });
  }

  function insertDivider() {
    const { start, end } = selection();
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
    const suffix = end < value.length && value[end] !== "\n" ? "\n\n" : "";
    const replacement = `${prefix}---${suffix}`;
    applyEdit({
      value: value.slice(0, start) + replacement + value.slice(end),
      selectionStart: start + replacement.length,
      selectionEnd: start + replacement.length,
    });
  }

  const actions: ToolbarAction[] = [
    { id: "h1", label: "H1", title: "제목 1 (Ctrl+Alt+1)", run: () => lineStyle("heading1") },
    { id: "h2", label: "H2", title: "제목 2 (Ctrl+Alt+2)", run: () => lineStyle("heading2") },
    { id: "h3", label: "H3", title: "제목 3 (Ctrl+Alt+3)", run: () => lineStyle("heading3") },
    { id: "bold", label: "B", title: "굵게 (Ctrl+B)", run: () => wrap("**", "**", "굵은 글씨") },
    { id: "strike", label: "S", title: "취소선 (Ctrl+Shift+X)", run: () => wrap("~~", "~~", "취소선") },
    { id: "inline-code", label: "`", title: "인라인 코드", run: () => wrap("`", "`", "코드") },
    { id: "link", label: "↗", title: "외부 링크 (Ctrl+K)", run: insertLink },
    { id: "highlight", label: "==", title: "하이라이트 (Ctrl+Alt+H)", run: () => wrap("==", "==", "강조") },
    { id: "bullet", label: "•", title: "글머리 목록 (Ctrl+Shift+8)", run: () => lineStyle("bullet") },
    { id: "ordered", label: "1.", title: "번호 목록 (Ctrl+Shift+7)", run: () => lineStyle("ordered") },
    { id: "check", label: "☑", title: "체크리스트 (Ctrl+Alt+C)", run: () => lineStyle("checklist") },
    { id: "quote", label: "❝", title: "인용 (Ctrl+Alt+Q)", run: () => lineStyle("quote") },
    { id: "code-block", label: "```", title: "코드 블록", run: insertCodeBlock },
    {
      id: "table",
      label: "▦",
      title: "표 삽입 (Ctrl+Alt+T)",
      run: () => {
        const { start, end } = selection();
        applyEdit(insertMarkdownTable(value, start, end));
      },
    },
    { id: "divider", label: "―", title: "구분선", run: insertDivider },
  ];

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const command = event.ctrlKey || event.metaKey;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    let result: MarkdownEditResult | null = null;

    if (event.key === "Escape" && onDone) {
      event.preventDefault();
      onDone();
      return;
    }
    if (command && event.key === "Enter" && onDone) {
      event.preventDefault();
      onDone();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      applyEdit(indentMarkdownLines(value, start, end, event.shiftKey));
      return;
    }
    if (event.key === "Enter" && !command) {
      result = continueMarkdownLine(value, start, end);
    } else if (event.key === "Backspace" && start === end) {
      result = removeEmptyMarkdownPrefix(value, start);
    } else if (command && !event.altKey && event.key.toLowerCase() === "b") {
      result = toggleMarkdownSelection(value, start, end, "**", "**", "굵은 글씨");
    } else if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      insertLink();
      return;
    } else if (command && event.shiftKey && event.key.toLowerCase() === "x") {
      result = toggleMarkdownSelection(value, start, end, "~~", "~~", "취소선");
    } else if (command && event.altKey && event.key.toLowerCase() === "h") {
      result = toggleMarkdownSelection(value, start, end, "==", "==", "강조");
    } else if (command && event.altKey && ["1", "2", "3"].includes(event.key)) {
      result = applyMarkdownLineStyle(value, start, end, `heading${event.key}` as MarkdownLineStyle);
    } else if (command && event.shiftKey && event.code === "Digit8") {
      result = applyMarkdownLineStyle(value, start, end, "bullet");
    } else if (command && event.shiftKey && event.code === "Digit7") {
      result = applyMarkdownLineStyle(value, start, end, "ordered");
    } else if (command && event.altKey && event.key.toLowerCase() === "c") {
      result = applyMarkdownLineStyle(value, start, end, "checklist");
    } else if (command && event.altKey && event.key.toLowerCase() === "q") {
      result = applyMarkdownLineStyle(value, start, end, "quote");
    } else if (command && event.altKey && event.key.toLowerCase() === "t") {
      result = insertMarkdownTable(value, start, end);
    }

    if (result) {
      event.preventDefault();
      applyEdit(result);
    }
  }

  return (
    <div className={`markdown-composer ${compact ? "compact" : ""}`}>
      <div className="markdown-toolbar" role="toolbar" aria-label="마크다운 서식">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`markdown-tool markdown-tool-${action.id}`}
            title={action.title}
            aria-label={action.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action.run}
          >
            {action.label}
          </button>
        ))}
        {onDone ? (
          <button type="button" className="markdown-editor-done" onClick={onDone} title="편집 완료 (Ctrl+Enter 또는 Esc)">
            완료
          </button>
        ) : null}
      </div>
      <textarea
        ref={(node) => {
          localRef.current = node;
          if (textareaRef) textareaRef.current = node;
        }}
        className="note-content-textarea markdown-source-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => onSelectionChange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onContextMenu={onContextMenu}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        spellCheck
        maxLength={500_000}
      />
    </div>
  );
}
