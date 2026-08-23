import { createContext, useContext, type ChangeEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  emptyText?: string;
  checklistDisabled?: boolean;
  checklistUncontrolled?: boolean;
  onChecklistToggle?: (lineIndex: number, checked: boolean) => void;
}

interface MarkdownAstNode {
  type?: string;
  value?: string;
  children?: MarkdownAstNode[];
  data?: { hName?: string };
}

const ChecklistLineContext = createContext(-1);

function ChecklistInput({
  type,
  checked,
  uncontrolled,
  disabled,
  onToggle,
}: {
  type?: string;
  checked?: boolean;
  uncontrolled: boolean;
  disabled: boolean;
  onToggle?: (lineIndex: number, checked: boolean) => void;
}) {
  const lineIndex = useContext(ChecklistLineContext);
  if (type !== "checkbox") return null;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (lineIndex >= 0) onToggle?.(lineIndex, event.target.checked);
  };
  return (
    <input
      type="checkbox"
      checked={uncontrolled ? undefined : Boolean(checked)}
      defaultChecked={uncontrolled ? Boolean(checked) : undefined}
      disabled={disabled}
      onChange={handleChange}
    />
  );
}

function remarkHighlight() {
  return (tree: MarkdownAstNode) => {
    function transform(parent: MarkdownAstNode) {
      if (!parent.children || parent.type === "code" || parent.type === "inlineCode") return;
      const nextChildren: MarkdownAstNode[] = [];
      for (const child of parent.children) {
        if (child.type !== "text" || !child.value?.includes("==")) {
          transform(child);
          nextChildren.push(child);
          continue;
        }

        const pattern = /==([^=\n]+)==/g;
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(child.value)) !== null) {
          if (match.index > cursor) nextChildren.push({ type: "text", value: child.value.slice(cursor, match.index) });
          nextChildren.push({
            type: "highlight",
            data: { hName: "mark" },
            children: [{ type: "text", value: match[1] }],
          });
          cursor = match.index + match[0].length;
        }
        if (cursor < child.value.length) nextChildren.push({ type: "text", value: child.value.slice(cursor) });
      }
      parent.children = nextChildren;
    }
    transform(tree);
  };
}

function toSafeExternalUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2_048 || Array.from(value).some((character) => {
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

export function MarkdownRenderer({
  content,
  emptyText = "작성된 메모가 없습니다.",
  checklistDisabled = false,
  checklistUncontrolled = false,
  onChecklistToggle,
}: MarkdownRendererProps) {
  if (!content.trim()) return <p className="empty-text">{emptyText}</p>;

  // remark-gfm does not classify a task item with no label as a checkbox.
  // Add an invisible render-only label while keeping the stored Markdown untouched.
  const renderContent = content.replace(/^(\s*[-*+]\s+\[[ xX]\])\s*$/gm, "$1 \u200B");

  const components: Components = {
    a({ href, children }) {
      const safeHref = toSafeExternalUrl(href);
      return safeHref ? (
        <a href={safeHref} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : <>{children}</>;
    },
    img({ alt }) {
      return alt ? <span className="markdown-image-alt">{alt}</span> : null;
    },
    table({ children }) {
      return (
        <div className="markdown-table-scroll">
          <table>{children}</table>
        </div>
      );
    },
    li({ node, className, children }) {
      const lineIndex = node?.position?.start.line ? node.position.start.line - 1 : -1;
      return (
        <ChecklistLineContext.Provider value={lineIndex}>
          <li className={className}>{children}</li>
        </ChecklistLineContext.Provider>
      );
    },
    input({ type, checked }) {
      return (
        <ChecklistInput
          type={type}
          checked={checked}
          uncontrolled={checklistUncontrolled}
          disabled={checklistDisabled}
          onToggle={onChecklistToggle}
        />
      );
    },
  };

  return (
    <div className="markdown-renderer">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkHighlight]} components={components}>
        {renderContent}
      </ReactMarkdown>
    </div>
  );
}
