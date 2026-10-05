import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

interface MarkdownNode {
  type: string;
  checked?: boolean | null;
  children?: MarkdownNode[];
  position?: { start: { line: number; offset?: number }; end: { offset?: number } };
}

export interface NoteChecklistItem {
  lineIndex: number;
  text: string;
  checked: boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm);
const marker = /^(?:\s*>\s*)*\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;

/** Parse actual GFM task items; examples inside code blocks are never tasks. */
export function readNoteChecklist(content: string): NoteChecklistItem[] {
  if (!/\[[ xX]\]/.test(content)) return [];
  const lines = content.split(/\r\n|\r|\n/);
  const items: NoteChecklistItem[] = [];
  function visit(node: MarkdownNode) {
    if (node.type === "listItem" && typeof node.checked === "boolean" && node.position) {
      const lineIndex = node.position.start.line - 1;
      const match = lines[lineIndex]?.match(marker);
      if (match) items.push({ lineIndex, checked: node.checked, text: match[2].trim().replace(/(\*\*|__|~~|`)/g, "") });
    }
    node.children?.forEach(visit);
  }
  visit(parser.parse(content) as MarkdownNode);
  return items;
}

export function setNoteChecklistItem(content: string, lineIndex: number, checked: boolean): string {
  if (!readNoteChecklist(content).some((item) => item.lineIndex === lineIndex)) {
    throw new Error("체크리스트 항목이 변경되었습니다. 목록을 확인한 뒤 다시 시도해 주세요.");
  }
  // Keep source line endings and every character outside the task marker intact.
  const parts = content.split(/(\r\n|\r|\n)/);
  const index = lineIndex * 2;
  parts[index] = parts[index].replace(/^(.*?)\[([ xX])\](\s+)/, `$1[${checked ? "x" : " "}]$3`);
  return parts.join("");
}
