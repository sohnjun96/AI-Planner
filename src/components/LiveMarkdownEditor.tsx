import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import {
  filterMarkdownSlashCommands,
  nextMarkdownListDepth,
  parseMarkdownChecklistItemShortcut,
  parseMarkdownListShortcut,
} from "../utils/markdownEditing";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface LiveMarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const MAX_NOTE_CHARACTERS = 500_000;
const SLASH_MENU_ID = "live-markdown-slash-menu";
const REMOVABLE_INLINE_MARKER_SELECTOR = "strong, b, del, s, strike, mark, em, i, a:not(.markdown-image-link), code";

interface SlashMenuState {
  query: string;
  left: number;
  top: number;
  activeIndex: number;
}

const SLASH_COMMANDS = [
  { id: "heading1", label: "제목 1", description: "가장 큰 제목", keywords: "h1 heading" },
  { id: "heading2", label: "제목 2", description: "중간 제목", keywords: "h2 heading" },
  { id: "heading3", label: "제목 3", description: "작은 제목", keywords: "h3 heading" },
  { id: "bullet", label: "글머리 목록", description: "순서 없는 목록", keywords: "bullet list 목록" },
  { id: "ordered", label: "번호 목록", description: "순서가 있는 목록", keywords: "number ordered list 목록" },
  { id: "checklist", label: "체크리스트", description: "할 일 항목", keywords: "task todo check" },
  { id: "quote", label: "인용", description: "인용문 블록", keywords: "quote blockquote" },
  { id: "code", label: "코드 블록", description: "여러 줄 코드", keywords: "code fence" },
  { id: "table", label: "표", description: "2열 표 삽입", keywords: "table grid" },
  { id: "divider", label: "구분선", description: "문단 구분", keywords: "divider horizontal rule hr" },
] as const;

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\u200b/g, "");
  }
  if (!(node instanceof HTMLElement)) return "";
  const body = Array.from(node.childNodes).map(inlineMarkdown).join("");
  switch (node.tagName) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return `**${body}**`;
    case "EM":
    case "I":
      return `*${body}*`;
    case "DEL":
    case "S":
    case "STRIKE":
      return `~~${body}~~`;
    case "MARK":
      return `==${body}==`;
    case "CODE":
      return node.parentElement?.tagName === "PRE" ? body : `\`${body}\``;
    case "A": {
      const href = node.getAttribute("href") ?? "";
      const label = node.classList.contains("markdown-image-link") ? body.replace(/^이미지:\s*/, "") : body;
      return node.classList.contains("markdown-image-link") ? `![${label}](${href})` : `[${label}](${href})`;
    }
    case "INPUT":
      return "";
    default:
      return body;
  }
}

function directInlineMarkdown(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node) => !(node instanceof HTMLElement && ["UL", "OL"].includes(node.tagName)))
    .map(inlineMarkdown)
    .join("")
    .replace(/\s+$/g, "");
}

function listMarkdown(list: HTMLElement, depth = 0): string {
  const ordered = list.tagName === "OL";
  const start = Number(list.getAttribute("start") ?? "1") || 1;
  const lines: string[] = [];
  let itemIndex = 0;
  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLLIElement)) {
      if (child instanceof HTMLElement && ["UL", "OL"].includes(child.tagName)) {
        const nested = listMarkdown(child, depth + 1);
        if (nested) lines.push(nested);
      }
      return;
    }
    const item = child;
    const visualDepth = Math.min(4, Math.max(0, Math.round((Number.parseFloat(item.style.marginLeft) || 0) / 16)));
    const itemDepth = depth + visualDepth;
    const checkbox = Array.from(item.children).find(
      (child): child is HTMLInputElement => child instanceof HTMLInputElement && child.type === "checkbox",
    );
    const prefix = checkbox ? `- [${checkbox.checked ? "x" : " "}] ` : ordered ? `${start + itemIndex}. ` : "- ";
    lines.push(`${"  ".repeat(itemDepth)}${prefix}${directInlineMarkdown(item)}`.trimEnd());
    Array.from(item.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && ["UL", "OL"].includes(child.tagName))
      .forEach((nested) => {
        const nestedMarkdown = listMarkdown(nested, itemDepth + 1);
        if (nestedMarkdown) lines.push(nestedMarkdown);
      });
    itemIndex += 1;
  });
  return lines.join("\n");
}

function tableMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return "";
  const headers = Array.from(rows[0].cells).map((cell) => inlineMarkdown(cell).replace(/\|/g, "\\|").trim());
  const alignments = Array.from(rows[0].cells).map((cell) => {
    const alignment = cell.style.textAlign;
    return alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---";
  });
  const bodyRows = rows.slice(1).map((row) =>
    Array.from(row.cells).map((cell) => inlineMarkdown(cell).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim()),
  );
  return [headers, alignments, ...bodyRows].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

function blockMarkdown(element: HTMLElement): string {
  const tag = element.tagName;
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inlineMarkdown(element).trim()}`;
  if (tag === "UL" || tag === "OL") return listMarkdown(element);
  if (tag === "BLOCKQUOTE") {
    const content = (element.children.length > 0 ? serializeBlocks(element) : inlineMarkdown(element)).trim();
    return content
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
  }
  if (tag === "PRE") {
    const code = element.querySelector("code");
    const language = Array.from(code?.classList ?? [])
      .find((name) => name.startsWith("language-"))
      ?.slice(9);
    return `\`\`\`${language ?? ""}\n${code?.textContent ?? element.textContent ?? ""}\n\`\`\``;
  }
  if (tag === "HR") return "---";
  if (tag === "TABLE") return tableMarkdown(element as HTMLTableElement);
  if (element.classList.contains("markdown-table-scroll")) {
    const table = element.querySelector("table");
    return table ? tableMarkdown(table) : "";
  }
  if (element.classList.contains("markdown-renderer")) return serializeBlocks(element);
  if (["P", "DIV"].includes(tag)) {
    const nestedBlocks = Array.from(element.children).filter((child) =>
      ["H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "TABLE"].includes(child.tagName),
    );
    return nestedBlocks.length > 0 ? serializeBlocks(element) : inlineMarkdown(element).trimEnd();
  }
  return inlineMarkdown(element).trimEnd();
}

function serializeBlocks(root: HTMLElement): string {
  return Array.from(root.childNodes)
    .map((child) => (child instanceof HTMLElement ? blockMarkdown(child) : inlineMarkdown(child).trimEnd()))
    .filter((block) => block.trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function LiveMarkdownEditor({ content, onChange, placeholder = "내용을 입력하세요." }: LiveMarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const activeBlockRef = useRef<HTMLElement | null>(null);
  const slashBlockRef = useRef<HTMLParagraphElement | null>(null);
  const isComposingRef = useRef(false);
  const uiSyncTimerRef = useRef<number | undefined>(undefined);
  const syncEditorUiRef = useRef<() => void>(() => undefined);
  const [renderedContent, setRenderedContent] = useState(content);
  const [renderRevision, setRenderRevision] = useState(0);
  const [isEmpty, setIsEmpty] = useState(!content.trim());
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (content === lastEmittedRef.current) return;
    if (content !== renderedContent) {
      activeBlockRef.current?.classList.remove("markdown-active-block");
      activeBlockRef.current = null;
      slashBlockRef.current = null;
      setSlashMenu(null);
      setRenderedContent(content);
      setIsEmpty(!content.trim());
      setRenderRevision((revision) => revision + 1);
    }
  }, [content, renderedContent]);

  useEffect(() => () => {
    if (uiSyncTimerRef.current !== undefined) window.clearTimeout(uiSyncTimerRef.current);
  }, []);

  function currentMarkdown(): string {
    const editor = editorRef.current;
    if (!editor) return content;
    const renderer = editor.querySelector<HTMLElement>(":scope > .markdown-renderer");
    return (renderer ? serializeBlocks(renderer) : serializeBlocks(editor)).trimEnd();
  }

  function selectionElement(): HTMLElement | null {
    const anchorNode = window.getSelection()?.anchorNode;
    if (!anchorNode) return null;
    return anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
  }

  function clearActiveBlock() {
    activeBlockRef.current?.classList.remove("markdown-active-block");
    activeBlockRef.current = null;
  }

  function updateActiveBlock() {
    const editor = editorRef.current;
    const renderer = editor?.querySelector<HTMLElement>(":scope > .markdown-renderer");
    const anchorElement = selectionElement();
    if (!editor || !renderer || !anchorElement || !editor.contains(anchorElement)) {
      clearActiveBlock();
      return;
    }
    let block: HTMLElement | null = anchorElement;
    while (block && block.parentElement !== renderer) block = block.parentElement;
    if (!block || block.parentElement !== renderer) {
      clearActiveBlock();
      return;
    }
    if (activeBlockRef.current === block) return;
    clearActiveBlock();
    block.classList.add("markdown-active-block");
    activeBlockRef.current = block;
  }

  function updateSlashMenu() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const anchorElement = selectionElement();
    const renderer = editor?.querySelector<HTMLElement>(":scope > .markdown-renderer");
    const paragraph = anchorElement?.closest<HTMLParagraphElement>("p");
    if (
      !editor ||
      !renderer ||
      !selection ||
      !selection.isCollapsed ||
      !paragraph ||
      paragraph.parentElement !== renderer
    ) {
      slashBlockRef.current = null;
      setSlashMenu(null);
      return;
    }
    const match = (paragraph.textContent ?? "").match(/^\/([^\s/]{0,24})$/u);
    if (!match) {
      slashBlockRef.current = null;
      setSlashMenu(null);
      return;
    }
    const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const anchorLeft = rangeRect.left || editorRect.left + 16;
    const anchorBottom = rangeRect.bottom || editorRect.top + 36;
    const anchorTop = rangeRect.top || editorRect.top + 20;
    const left = Math.max(8, Math.min(anchorLeft, window.innerWidth - 288));
    const preferredTop = anchorBottom + 8;
    const top = preferredTop + 320 > window.innerHeight ? Math.max(8, anchorTop - 320) : preferredTop;
    slashBlockRef.current = paragraph;
    setSlashMenu((previous) => ({
      query: match[1],
      left,
      top,
      activeIndex: previous?.query === match[1] ? previous.activeIndex : 0,
    }));
  }

  function scheduleEditorUiSync() {
    if (uiSyncTimerRef.current !== undefined) window.clearTimeout(uiSyncTimerRef.current);
    uiSyncTimerRef.current = window.setTimeout(() => {
      uiSyncTimerRef.current = undefined;
      updateActiveBlock();
      updateSlashMenu();
    }, 0);
  }

  syncEditorUiRef.current = scheduleEditorUiSync;

  useEffect(() => {
    const timer = window.setTimeout(() => syncEditorUiRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [content]);

  function emitChange() {
    const next = currentMarkdown();
    if (next.length > MAX_NOTE_CHARACTERS) {
      setRenderedContent(content);
      setRenderRevision((revision) => revision + 1);
      return;
    }
    lastEmittedRef.current = next;
    setIsEmpty(!next.trim());
    onChange(next);
  }

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitChange();
    updateActiveBlock();
  }

  function listItemDepth(item: HTMLLIElement): number {
    return Math.min(4, Math.max(0, Math.round((Number.parseFloat(item.style.marginLeft) || 0) / 16)));
  }

  function changeListItemDepth(item: HTMLLIElement, outdent: boolean) {
    const previous = item.previousElementSibling instanceof HTMLLIElement ? item.previousElementSibling : undefined;
    const nextDepth = nextMarkdownListDepth(
      listItemDepth(item),
      previous ? listItemDepth(previous) : undefined,
      outdent,
    );
    if (nextDepth === listItemDepth(item)) return;
    if (nextDepth === 0) item.style.removeProperty("margin-left");
    else item.style.marginLeft = `${nextDepth * 16}px`;
    emitChange();
    updateActiveBlock();
  }

  function containingMark(node: Node | null): HTMLElement | null {
    const element = node instanceof HTMLElement ? node : node?.parentElement;
    const mark = element?.closest<HTMLElement>("mark") ?? null;
    return mark && editorRef.current?.contains(mark) ? mark : null;
  }

  function removeMark(mark: HTMLElement) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  }

  function toggleHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const startMark = containingMark(range.startContainer);
    const endMark = containingMark(range.endContainer);

    if (range.collapsed) {
      if (!startMark) return;
      removeMark(startMark);
      emitChange();
      updateActiveBlock();
      return;
    }

    if (startMark && startMark === endMark) {
      removeMark(startMark);
      emitChange();
      updateActiveBlock();
      return;
    }

    if (!selection.toString()) return;
    const root = range.commonAncestorContainer;
    const textNodes: Text[] = [];
    if (root instanceof Text) {
      textNodes.push(root);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current instanceof Text && range.intersectsNode(current) && editorRef.current.contains(current)) {
          textNodes.push(current);
        }
        current = walker.nextNode();
      }
    }

    const marks: HTMLElement[] = [];
    textNodes.forEach((textNode) => {
      if (!textNode.data || containingMark(textNode)) return;
      const start = textNode === range.startContainer ? range.startOffset : 0;
      const end = textNode === range.endContainer ? range.endOffset : textNode.length;
      if (start >= end) return;
      const selectedText = start > 0 ? textNode.splitText(start) : textNode;
      if (end - start < selectedText.length) selectedText.splitText(end - start);
      const mark = document.createElement("mark");
      selectedText.replaceWith(mark);
      mark.append(selectedText);
      marks.push(mark);
    });
    if (marks.length === 0) return;

    selection.removeAllRanges();
    const highlightedRange = document.createRange();
    highlightedRange.setStartBefore(marks[0]);
    highlightedRange.setEndAfter(marks[marks.length - 1]);
    selection.addRange(highlightedRange);
    emitChange();
    updateActiveBlock();
  }

  function insertBlockAtSelection(block: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const anchorNode = selection.anchorNode;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
    const currentBlock = anchorElement?.closest<HTMLElement>("h1, h2, h3, h4, h5, h6, p, blockquote, li, pre, .markdown-table-scroll");
    const trailing = document.createElement("p");

    if (currentBlock && editorRef.current.contains(currentBlock)) {
      if (["H1", "H2", "H3", "H4", "H5", "H6", "P", "BLOCKQUOTE"].includes(currentBlock.tagName)) {
        trailing.append(splitAtSelection(currentBlock, selection));
        currentBlock.after(block, trailing);
        if (!currentBlock.textContent?.trim()) currentBlock.remove();
      } else {
        const placementTarget = currentBlock.tagName === "LI" ? currentBlock.parentElement ?? currentBlock : currentBlock;
        selection.getRangeAt(0).deleteContents();
        placementTarget.after(block, trailing);
      }
    } else {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(trailing);
      range.insertNode(block);
    }

    ensureEditableLine(trailing);
    placeCaretAtStart(trailing);
    emitChange();
    updateActiveBlock();
  }

  function insertTable() {
    const table = document.createElement("table");
    const header = table.createTHead().insertRow();
    ["항목", "내용"].forEach((label) => {
      const cell = document.createElement("th");
      cell.textContent = label;
      header.append(cell);
    });
    const row = table.createTBody().insertRow();
    row.insertCell().textContent = "값";
    row.insertCell().textContent = "값";
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    wrapper.append(table);
    insertBlockAtSelection(wrapper);
    const selection = window.getSelection();
    const firstCell = header.cells.item(0);
    if (selection && firstCell) {
      const cellRange = document.createRange();
      cellRange.selectNodeContents(firstCell);
      cellRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(cellRange);
      updateActiveBlock();
    }
  }

  function insertCodeBlock() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = selection.toString() || "코드";
    pre.append(code);
    insertBlockAtSelection(pre);
    selection.selectAllChildren(code);
  }

  function insertChecklist() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const list = document.createElement("ul");
    list.className = "markdown-checklist";
    const item = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    const text = document.createElement("span");
    text.textContent = selection.toString() || "할 일";
    item.append(checkbox, text);
    list.append(item);
    insertBlockAtSelection(list);
    selection.selectAllChildren(text);
  }

  function insertDivider() {
    insertBlockAtSelection(document.createElement("hr"));
  }

  function insertPlainText(text: string) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      if (index > 0) fragment.append(document.createElement("br"));
      fragment.append(document.createTextNode(line));
    });
    range.insertNode(fragment);
    selection.collapseToEnd();
    transformMarkdownHeadingShortcut();
    emitChange();
  }

  function placeCaretAtStart(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtEnd(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function ensureEditableLine(element: HTMLElement) {
    if (!element.textContent && !element.querySelector("br")) {
      element.append(document.createElement("br"));
    }
  }

  function caretIsAtStartOf(element: HTMLElement, selection: Selection): boolean {
    if (!selection.isCollapsed || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return false;
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(element);
    beforeCaret.setEnd(range.startContainer, range.startOffset);
    return beforeCaret.toString().length === 0;
  }

  function caretIsAtEndOf(element: HTMLElement, selection: Selection): boolean {
    if (!selection.isCollapsed || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.endContainer)) return false;
    const afterCaret = document.createRange();
    afterCaret.selectNodeContents(element);
    afterCaret.setStart(range.endContainer, range.endOffset);
    return afterCaret.toString().length === 0;
  }

  function unwrapInlineElement(element: HTMLElement, caretAtEnd: boolean) {
    const parent = element.parentNode;
    if (!parent) return;
    const children = Array.from(element.childNodes);
    const fallback = document.createTextNode("");
    const first = children[0] ?? fallback;
    const last = children.at(-1) ?? fallback;
    if (children.length === 0) parent.insertBefore(fallback, element);
    else children.forEach((child) => parent.insertBefore(child, element));
    element.remove();

    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    if (caretAtEnd) range.setStartAfter(last);
    else range.setStartBefore(first);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isRemovableInlineMarker(element: Node | null): element is HTMLElement {
    return Boolean(
      element instanceof HTMLElement &&
      element.matches(REMOVABLE_INLINE_MARKER_SELECTOR) &&
      !(element.tagName === "CODE" && element.closest("pre")),
    );
  }

  function adjacentInlineMarker(selection: Selection, backward: boolean): HTMLElement | null {
    if (!selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    let candidate: ChildNode | null = null;

    if (container instanceof Text) {
      if (backward && range.startOffset === 0) candidate = container.previousSibling;
      else if (!backward && range.startOffset === container.length) candidate = container.nextSibling;
    } else {
      const index = backward ? range.startOffset - 1 : range.startOffset;
      candidate = index >= 0 ? container.childNodes.item(index) : null;
    }

    while (candidate instanceof Text && candidate.length === 0) {
      candidate = backward ? candidate.previousSibling : candidate.nextSibling;
    }
    return isRemovableInlineMarker(candidate) ? candidate : null;
  }

  function handleInlineMarkerRemoval(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    const containingMarker = anchorElement?.closest(REMOVABLE_INLINE_MARKER_SELECTOR) ?? null;
    let inlineMarker = isRemovableInlineMarker(containingMarker) ? containingMarker : null;
    let caretAtEnd = false;

    if (inlineMarker) {
      const isAtStart = caretIsAtStartOf(inlineMarker, selection);
      const isAtEnd = caretIsAtEndOf(inlineMarker, selection);
      if (!isAtStart && !isAtEnd) inlineMarker = null;
      else caretAtEnd = isAtEnd && !isAtStart;
    }

    if (!inlineMarker) {
      const backward = event.key === "Backspace";
      inlineMarker = adjacentInlineMarker(selection, backward);
      caretAtEnd = backward;
    }
    if (!inlineMarker || !editorRef.current.contains(inlineMarker)) return false;

    event.preventDefault();
    unwrapInlineElement(inlineMarker, caretAtEnd);
    emitChange();
    updateActiveBlock();
    scheduleEditorUiSync();
    return true;
  }

  function replaceTextBlockTag(block: HTMLElement, tagName: string): HTMLElement {
    const replacement = document.createElement(tagName);
    while (block.firstChild) replacement.append(block.firstChild);
    ensureEditableLine(replacement);
    block.replaceWith(replacement);
    placeCaretAtStart(replacement);
    return replacement;
  }

  function handleMarkdownMarkerBackspace(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    if (!anchorElement) return false;

    const heading = anchorElement.closest<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (heading && editorRef.current.contains(heading) && caretIsAtStartOf(heading, selection)) {
      event.preventDefault();
      const level = Number(heading.tagName.slice(1));
      clearActiveBlock();
      replaceTextBlockTag(heading, level > 1 ? `h${level - 1}` : "p");
      emitChange();
      updateActiveBlock();
      scheduleEditorUiSync();
      return true;
    }

    const quote = anchorElement.closest<HTMLElement>("blockquote");
    if (quote && editorRef.current.contains(quote) && caretIsAtStartOf(quote, selection)) {
      event.preventDefault();
      clearActiveBlock();
      replaceTextBlockTag(quote, "p");
      emitChange();
      updateActiveBlock();
      scheduleEditorUiSync();
      return true;
    }

    return false;
  }

  function transformMarkdownHeadingShortcut(): boolean {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !selection.isCollapsed || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    const paragraph = anchorElement?.closest<HTMLParagraphElement>("p");
    if (
      !paragraph ||
      !editorRef.current.contains(paragraph) ||
      paragraph.closest("li, blockquote, td, th")
    ) return false;
    const match = (paragraph.textContent ?? "").match(/^(#{1,6})[ \u00a0]+([^\r\n]*)$/);
    if (!match) return false;

    const heading = document.createElement(`h${match[1].length}`);
    heading.textContent = match[2];
    ensureEditableLine(heading);
    paragraph.replaceWith(heading);
    if (match[2]) placeCaretAtEnd(heading);
    else placeCaretAtStart(heading);
    return true;
  }

  function transformMarkdownListShortcut(): boolean {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !selection.isCollapsed || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    const paragraph = anchorElement?.closest<HTMLParagraphElement>("p");
    if (!paragraph || !editorRef.current.contains(paragraph) || paragraph.closest("li, blockquote, td, th")) return false;
    const shortcut = parseMarkdownListShortcut(paragraph.textContent ?? "");
    if (!shortcut) return false;

    const list = document.createElement(shortcut.kind === "ordered" ? "ol" : "ul");
    if (shortcut.kind === "ordered" && shortcut.start !== 1) list.setAttribute("start", String(shortcut.start));
    if (shortcut.kind === "checklist") list.className = "markdown-checklist";
    const item = document.createElement("li");
    let contentContainer: HTMLElement = item;
    if (shortcut.kind === "checklist") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = shortcut.checked;
      checkbox.contentEditable = "false";
      const text = document.createElement("span");
      item.append(checkbox, text);
      contentContainer = text;
    }
    contentContainer.textContent = shortcut.body;
    ensureEditableLine(contentContainer);
    list.append(item);
    paragraph.replaceWith(list);
    if (shortcut.body) placeCaretAtEnd(contentContainer);
    else placeCaretAtStart(contentContainer);
    return true;
  }

  function transformMarkdownChecklistItemShortcut(): boolean {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || !selection.isCollapsed || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    const item = anchorElement?.closest<HTMLLIElement>("li");
    const list = item?.parentElement;
    if (!item || !list || list.tagName !== "UL" || !editorRef.current.contains(item)) return false;
    if (item.querySelector(":scope > input[type='checkbox']")) return false;
    const shortcut = parseMarkdownChecklistItemShortcut(directInlineMarkdown(item));
    if (!shortcut) return false;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = shortcut.checked;
    checkbox.contentEditable = "false";
    const text = document.createElement("span");
    text.textContent = shortcut.body;
    ensureEditableLine(text);
    item.replaceChildren(checkbox, text);
    list.classList.add("markdown-checklist");
    if (shortcut.body) placeCaretAtEnd(text);
    else placeCaretAtStart(text);
    return true;
  }

  function transformMarkdownTypingShortcut() {
    if (transformMarkdownHeadingShortcut()) return;
    if (transformMarkdownListShortcut()) return;
    transformMarkdownChecklistItemShortcut();
  }

  function splitAtSelection(container: HTMLElement, selection: Selection): DocumentFragment {
    const range = selection.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    const tail = document.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(container, container.childNodes.length);
    return tail.extractContents();
  }

  function handleStructuredEnter(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (event.shiftKey) return false;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (!selection || selection.rangeCount === 0 || !anchorNode || !editorRef.current?.contains(anchorNode)) return false;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    if (!anchorElement || anchorElement.closest("pre, code, td, th")) return false;

    const item = anchorElement.closest("li");
    if (item && editorRef.current.contains(item)) {
      event.preventDefault();
      const list = item.parentElement;
      if (!list || !["UL", "OL"].includes(list.tagName)) return true;
      const checkbox = item.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
      const contentContainer = checkbox ? item.querySelector<HTMLElement>(":scope > span") : item;
      const isEmptyItem = !directInlineMarkdown(item).trim();

      if (isEmptyItem) {
        const paragraph = document.createElement("p");
        paragraph.append(document.createElement("br"));
        list.after(paragraph);
        item.remove();
        if (!list.querySelector(":scope > li")) list.remove();
        placeCaretAtStart(paragraph);
        emitChange();
        return true;
      }

      const nextItem = document.createElement("li");
      if (item.style.marginLeft) nextItem.style.marginLeft = item.style.marginLeft;
      let nextContainer: HTMLElement = nextItem;
      if (checkbox) {
        const nextCheckbox = document.createElement("input");
        nextCheckbox.type = "checkbox";
        nextCheckbox.contentEditable = "false";
        const nextText = document.createElement("span");
        nextItem.append(nextCheckbox, nextText);
        nextContainer = nextText;
      }
      const tail = contentContainer?.contains(anchorNode) ? splitAtSelection(contentContainer, selection) : document.createDocumentFragment();
      nextContainer.append(tail);
      ensureEditableLine(nextContainer);
      item.after(nextItem);
      ensureEditableLine(contentContainer ?? item);
      placeCaretAtStart(nextContainer);
      emitChange();
      return true;
    }

    const block = anchorElement.closest<HTMLElement>("h1, h2, h3, h4, h5, h6, p, blockquote");
    if (!block || !editorRef.current.contains(block)) return false;
    event.preventDefault();
    const isEmptyBlock = !inlineMarkdown(block).trim();
    const nextBlock = document.createElement(block.tagName === "BLOCKQUOTE" && !isEmptyBlock ? "blockquote" : "p");
    if (!isEmptyBlock) nextBlock.append(splitAtSelection(block, selection));
    ensureEditableLine(block);
    ensureEditableLine(nextBlock);
    block.after(nextBlock);
    if (isEmptyBlock && block.tagName === "BLOCKQUOTE") block.remove();
    placeCaretAtStart(nextBlock);
    emitChange();
    return true;
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    insertPlainText(event.clipboardData.getData("text/plain").slice(0, MAX_NOTE_CHARACTERS));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain");
    if (text) insertPlainText(text.slice(0, MAX_NOTE_CHARACTERS));
  }

  const filteredSlashCommands = filterMarkdownSlashCommands(SLASH_COMMANDS, slashMenu?.query ?? "", 10);

  function runSlashCommand(commandId: string) {
    const block = slashBlockRef.current;
    if (!block || !editorRef.current?.contains(block)) {
      setSlashMenu(null);
      return;
    }
    block.replaceChildren(document.createElement("br"));
    placeCaretAtStart(block);
    slashBlockRef.current = null;
    setSlashMenu(null);

    switch (commandId) {
      case "heading1":
        runCommand("formatBlock", "H1");
        break;
      case "heading2":
        runCommand("formatBlock", "H2");
        break;
      case "heading3":
        runCommand("formatBlock", "H3");
        break;
      case "bullet":
        runCommand("insertUnorderedList");
        break;
      case "ordered":
        runCommand("insertOrderedList");
        break;
      case "checklist":
        insertChecklist();
        break;
      case "quote":
        runCommand("formatBlock", "BLOCKQUOTE");
        break;
      case "code":
        insertCodeBlock();
        break;
      case "table":
        insertTable();
        break;
      case "divider":
        insertDivider();
        break;
      default:
        emitChange();
    }
    updateActiveBlock();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposingRef.current || event.nativeEvent.isComposing) return;
    if (slashMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (filteredSlashCommands.length > 0) {
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setSlashMenu((menu) => menu ? {
            ...menu,
            activeIndex: (menu.activeIndex + direction + filteredSlashCommands.length) % filteredSlashCommands.length,
          } : menu);
        }
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && filteredSlashCommands.length > 0) {
        event.preventDefault();
        const command = filteredSlashCommands[Math.min(slashMenu.activeIndex, filteredSlashCommands.length - 1)];
        if (command) runSlashCommand(command.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        slashBlockRef.current = null;
        setSlashMenu(null);
        return;
      }
    }
    const command = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      editorRef.current?.blur();
      return;
    }
    if (["Backspace", "Delete"].includes(event.key) && handleInlineMarkerRemoval(event)) return;
    if (event.key === "Backspace" && handleMarkdownMarkerBackspace(event)) return;
    if (event.key === "Enter" && handleStructuredEnter(event)) return;
    if (event.key === "Tab") {
      const item = selectionElement()?.closest("li");
      if (item instanceof HTMLLIElement && editorRef.current?.contains(item)) {
        event.preventDefault();
        changeListItemDepth(item, event.shiftKey);
      }
      return;
    }
    if (!command) return;
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      runCommand("bold");
    } else if (["i", "k", "e"].includes(event.key.toLowerCase()) && !event.altKey) {
      event.preventDefault();
    } else if (event.shiftKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      runCommand("strikeThrough");
    } else if (event.shiftKey && event.code === "Digit8") {
      event.preventDefault();
      runCommand("insertUnorderedList");
    } else if (event.shiftKey && event.code === "Digit7") {
      event.preventDefault();
      runCommand("insertOrderedList");
    } else if (event.altKey && ["1", "2", "3"].includes(event.key)) {
      event.preventDefault();
      runCommand("formatBlock", `H${event.key}`);
    } else if (event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      insertChecklist();
    } else if (event.altKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      insertTable();
    }
  }

  const toolbar = [
    ["H1", "제목 1 (Ctrl+Alt+1)", () => runCommand("formatBlock", "H1")],
    ["H2", "제목 2 (Ctrl+Alt+2)", () => runCommand("formatBlock", "H2")],
    ["H3", "제목 3 (Ctrl+Alt+3)", () => runCommand("formatBlock", "H3")],
    ["B", "굵게 (Ctrl+B)", () => runCommand("bold")],
    ["S", "취소선 (Ctrl+Shift+X)", () => runCommand("strikeThrough")],
    ["•", "글머리 목록 (Ctrl+Shift+8)", () => runCommand("insertUnorderedList")],
    ["1.", "번호 목록 (Ctrl+Shift+7)", () => runCommand("insertOrderedList")],
    ["☑", "체크리스트 (Ctrl+Alt+C)", insertChecklist],
    ["❝", "인용", () => runCommand("formatBlock", "BLOCKQUOTE")],
    ["```", "코드 블록", insertCodeBlock],
    ["▦", "표 삽입 (Ctrl+Alt+T)", insertTable],
    ["―", "구분선", insertDivider],
    ["==", "하이라이트 (선택 영역만)", toggleHighlight],
  ] as const;

  return (
    <div className="live-markdown-editor">
      <div className="markdown-toolbar" role="toolbar" aria-label="라이브 마크다운 서식">
        {toolbar.map(([label, title, run]) => (
          <button
            key={title}
            type="button"
            className="markdown-tool"
            title={title}
            aria-label={title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        key={renderRevision}
        ref={editorRef}
        className="live-markdown-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="노트 라이브 편집"
        aria-haspopup="listbox"
        aria-expanded={slashMenu !== null}
        aria-controls={slashMenu ? SLASH_MENU_ID : undefined}
        aria-activedescendant={slashMenu && filteredSlashCommands.length > 0 ? `${SLASH_MENU_ID}-${filteredSlashCommands[Math.min(slashMenu.activeIndex, filteredSlashCommands.length - 1)]?.id}` : undefined}
        data-empty={isEmpty ? "true" : "false"}
        data-placeholder={placeholder}
        onInput={() => {
          if (!isComposingRef.current) transformMarkdownTypingShortcut();
          updateActiveBlock();
          updateSlashMenu();
          emitChange();
          scheduleEditorUiSync();
        }}
        onClick={(event) => {
          const link = event.target instanceof Element ? event.target.closest("a") : null;
          if (link && !event.ctrlKey && !event.metaKey) event.preventDefault();
          if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
            emitChange();
          }
          updateActiveBlock();
          updateSlashMenu();
        }}
        onFocus={updateActiveBlock}
        onBlur={() => {
          clearActiveBlock();
          slashBlockRef.current = null;
          setSlashMenu(null);
        }}
        onMouseUp={updateActiveBlock}
        onKeyUp={() => {
          updateActiveBlock();
          updateSlashMenu();
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
          slashBlockRef.current = null;
          setSlashMenu(null);
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          transformMarkdownTypingShortcut();
          updateActiveBlock();
          updateSlashMenu();
          emitChange();
          scheduleEditorUiSync();
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
      >
        {renderedContent.trim() ? (
          <MarkdownRenderer content={renderedContent} checklistUncontrolled />
        ) : (
          <div className="markdown-renderer">
            <p>
              <br />
            </p>
          </div>
        )}
      </div>
      {slashMenu ? (
        <div
          id={SLASH_MENU_ID}
          className="markdown-slash-menu"
          role="listbox"
          aria-label="마크다운 블록 명령"
          style={{ left: slashMenu.left, top: slashMenu.top }}
        >
          {filteredSlashCommands.length > 0 ? filteredSlashCommands.map((command, index) => (
            <button
              id={`${SLASH_MENU_ID}-${command.id}`}
              key={command.id}
              type="button"
              className={`markdown-slash-option ${index === slashMenu.activeIndex ? "active" : ""}`}
              role="option"
              aria-selected={index === slashMenu.activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSlashMenu((menu) => menu ? { ...menu, activeIndex: index } : menu)}
              onClick={() => runSlashCommand(command.id)}
            >
              <strong>{command.label}</strong>
              <span>{command.description}</span>
            </button>
          )) : <p className="markdown-slash-empty">일치하는 명령 없음</p>}
        </div>
      ) : null}
    </div>
  );
}
