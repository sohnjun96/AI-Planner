import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeMirrorEditor,
  CodeToggle,
  CreateLink,
  HighlightToggle,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  maxLengthPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type CodeBlockEditorDescriptor,
  type MDXEditorMethods,
  type ViewMode,
  viewMode$,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { useCellValue, usePublisher } from "@mdxeditor/gurx";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normalizeLiveMarkdownWhitespace } from "../utils/markdownEditing";
import { findMarkdownSelection } from "../utils/markdownSelection";
import { stableMarkdownShortcutsPlugin } from "./StableMarkdownShortcutsPlugin";

interface LiveMarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
  onSelectionChange?: (start: number, end: number) => void;
  placeholder?: string;
  initialMode?: "edit" | "read";
  viewMode?: Extract<ViewMode, "rich-text" | "source">;
  onViewModeChange?: (viewMode: Extract<ViewMode, "rich-text" | "source">) => void;
}

const MAX_NOTE_CHARACTERS = 500_000;
const CODE_BLOCK_EDITOR: CodeBlockEditorDescriptor = {
  priority: -10,
  match: () => true,
  Editor: CodeMirrorEditor,
};

class EditorRuntimeBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
const KOREAN_EDITOR_MESSAGES: Record<string, string> = {
  "toolbar.richText": "라이브 편집",
  "toolbar.source": "원문 편집",
  "toolbar.bold": "굵게",
  "toolbar.removeBold": "굵게 해제",
  "toolbar.strikethrough": "취소선",
  "toolbar.removeStrikethrough": "취소선 해제",
  "toolbar.inlineCode": "인라인 코드",
  "toolbar.removeInlineCode": "인라인 코드 해제",
  "toolbar.highlight": "하이라이트",
  "toolbar.removeHighlight": "하이라이트 해제",
  "toolbar.link": "외부 링크",
  "toolbar.bulletedList": "글머리 목록",
  "toolbar.numberedList": "번호 목록",
  "toolbar.checkList": "체크리스트",
  "toolbar.table": "표 삽입",
  "toolbar.thematicBreak": "구분선 삽입",
  "toolbar.codeBlock": "코드 블록 삽입",
  "toolbar.undo": "실행 취소 {{shortcut}}",
  "toolbar.redo": "다시 실행 {{shortcut}}",
  "toolbar.blockTypes.paragraph": "본문",
  "toolbar.blockTypes.quote": "인용",
  "toolbar.blockTypes.heading": "제목 {{level}}",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "블록 형식 선택",
  "toolbar.blockTypeSelect.placeholder": "블록 형식",
  "table.deleteTable": "표 삭제",
  "table.columnMenu": "열 메뉴",
  "table.rowMenu": "행 메뉴",
  "table.textAlignment": "텍스트 정렬",
  "table.alignLeft": "왼쪽 정렬",
  "table.alignCenter": "가운데 정렬",
  "table.alignRight": "오른쪽 정렬",
  "table.insertColumnLeft": "왼쪽에 열 추가",
  "table.insertColumnRight": "오른쪽에 열 추가",
  "table.deleteColumn": "열 삭제",
  "table.insertRowAbove": "위에 행 추가",
  "table.insertRowBelow": "아래에 행 추가",
  "table.deleteRow": "행 삭제",
};

function translateEditorMessage(
  key: string,
  defaultValue: string,
  interpolations?: Record<string, unknown>,
): string {
  let value = KOREAN_EDITOR_MESSAGES[key] ?? defaultValue;
  for (const [name, replacement] of Object.entries(interpolations ?? {})) {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }
  return value;
}

function isSafeLink(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function EditorToolbar({
  requestedViewMode,
  onViewModeChange,
}: {
  requestedViewMode: Extract<ViewMode, "rich-text" | "source">;
  onViewModeChange?: (viewMode: Extract<ViewMode, "rich-text" | "source">) => void;
}) {
  const activeViewMode = useCellValue(viewMode$);
  const setViewMode = usePublisher(viewMode$);

  useEffect(() => {
    if (activeViewMode !== requestedViewMode) setViewMode(requestedViewMode);
  }, [activeViewMode, requestedViewMode, setViewMode]);

  useEffect(() => {
    if (activeViewMode === "rich-text" || activeViewMode === "source") {
      onViewModeChange?.(activeViewMode);
    }
  }, [activeViewMode, onViewModeChange]);

  if (activeViewMode !== "rich-text") {
    return <span className="note-editor-source-label">원문</span>;
  }

  return (
    <>
      <UndoRedo />
      <Separator />
      <BlockTypeSelect />
      <BoldItalicUnderlineToggles options={["Bold"]} />
      <StrikeThroughSupSubToggles options={["Strikethrough"]} />
      <CodeToggle />
      <HighlightToggle />
      <CreateLink />
      <Separator />
      <ListsToggle options={["bullet", "number", "check"]} />
      <InsertTable />
      <InsertThematicBreak />
      <InsertCodeBlock />
    </>
  );
}

export function LiveMarkdownEditor({
  content,
  onChange,
  onSelectionChange,
  placeholder = "내용을 입력하세요.",
  initialMode = "read",
  viewMode,
  onViewModeChange,
}: LiveMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const lastEmittedRef = useRef(content);
  const editorMarkdownRef = useRef(normalizeLiveMarkdownWhitespace(content));
  const composingRef = useRef(false);
  const pendingExternalContentRef = useRef<string | null>(null);
  const compositionFrameRef = useRef<number | null>(null);
  const [fallbackSource, setFallbackSource] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const requestedViewMode = viewMode ?? (initialMode === "edit" ? "source" : "rich-text");

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;

  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin({ disableAutoLink: true, validateUrl: isSafeLink }),
      linkDialogPlugin({ showLinkTitleField: false }),
      tablePlugin(),
      codeBlockPlugin({ codeBlockEditorDescriptors: [CODE_BLOCK_EDITOR], defaultCodeBlockLanguage: "txt" }),
      codeMirrorPlugin({
        autoLoadLanguageSupport: false,
        codeBlockLanguages: {
          txt: "일반 텍스트",
          md: "Markdown",
          js: "JavaScript",
          ts: "TypeScript",
          json: "JSON",
          css: "CSS",
          html: "HTML",
          python: "Python",
          sql: "SQL",
          bash: "Shell",
        },
      }),
      diffSourcePlugin({ viewMode: initialMode === "edit" ? "source" : "rich-text" }),
      markdownShortcutPlugin(),
      stableMarkdownShortcutsPlugin(),
      maxLengthPlugin(MAX_NOTE_CHARACTERS),
      toolbarPlugin({
        toolbarContents: () => (
          <EditorToolbar requestedViewMode={requestedViewMode} onViewModeChange={onViewModeChange} />
        ),
      }),
    ],
    [initialMode, onViewModeChange, requestedViewMode],
  );

  function emitMarkdown(value: string) {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    onChangeRef.current(value);
  }

  function captureSelection() {
    const root = rootRef.current;
    const selection = document.getSelection();
    if (!root || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
      onSelectionChangeRef.current?.(0, 0);
      return;
    }
    if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
      onSelectionChangeRef.current?.(0, 0);
      return;
    }

    const selectedMarkdown = editorRef.current?.getSelectionMarkdown() ?? "";
    const selectedText = selection.toString();
    const range = findMarkdownSelection(editorMarkdownRef.current, selectedMarkdown, selectedText);
    onSelectionChangeRef.current?.(range?.start ?? 0, range?.end ?? 0);
  }

  useEffect(() => {
    return () => {
      if (compositionFrameRef.current !== null) window.cancelAnimationFrame(compositionFrameRef.current);
      if (composingRef.current) emitMarkdown(editorMarkdownRef.current);
    };
  }, []);

  // 표의 행·열 메뉴는 에디터 루트에 포털로 렌더링된다. MDXEditor가 이 메뉴와
  // 메뉴 트리거를 편집 UI로 인식하지 못하면 버튼을 누르는 순간 셀 포커스를 잃고
  // 포털이 닫혀, 같은 포인터 입력이 아래 본문으로 전달될 수 있다.
  useEffect(() => {
    const editorRoot = rootRef.current;
    if (!editorRoot) return;
    const popoverSelector = '[class*="_tableColumnEditorPopoverContent_"]';

    const markTableEditorPopovers = (scope: ParentNode) => {
      if (scope instanceof HTMLElement && scope.matches(popoverSelector)) {
        scope.dataset.editorDropdown = "true";
      }
      scope.querySelectorAll<HTMLElement>(popoverSelector).forEach((popover) => {
        popover.dataset.editorDropdown = "true";
      });
    };

    const markTableEditorControls = () => {
      editorRoot
        .querySelectorAll<HTMLElement>(
          'table:has([data-tool-cell="true"]) [data-tool-cell="true"] button, table:has([data-tool-cell="true"]) > tfoot button',
        )
        .forEach((control) => {
          control.dataset.editorDropdown = "true";
        });
    };

    const preserveActiveCellOnTableChrome = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const table = target.closest<HTMLTableElement>('table:has([data-tool-cell="true"])');
      if (!table || !editorRoot.contains(table)) return;
      const activeCell = table.querySelector(
        'tbody > tr > :is(th, td):not([data-tool-cell="true"])[data-active="true"]',
      );
      if (!activeCell) return;

      const dataCell = target.closest('tbody > tr > :is(th, td):not([data-tool-cell="true"])');
      const interactiveControl = target.closest('button, [role="button"], input, select, textarea, a[href]');
      if (dataCell || interactiveControl) return;

      // 상단·측면·하단 편집 레일의 빈 영역은 셀 선택을 바꾸는 대상이 아니다.
      // 기본 포커스 이동만 막아 현재 셀 캐럿과 표 편집 UI를 그대로 유지한다.
      event.preventDefault();
    };

    markTableEditorPopovers(document);
    markTableEditorControls();
    const controlObserver = new MutationObserver(markTableEditorControls);
    const popoverObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) markTableEditorPopovers(node);
        });
      });
    });
    controlObserver.observe(editorRoot, { childList: true, subtree: true });
    popoverObserver.observe(document.body, { childList: true, subtree: true });
    editorRoot.addEventListener("pointerdown", preserveActiveCellOnTableChrome, true);
    return () => {
      controlObserver.disconnect();
      popoverObserver.disconnect();
      editorRoot.removeEventListener("pointerdown", preserveActiveCellOnTableChrome, true);
    };
  }, []);

  // `markdown` is an initial value in MDXEditor. Only genuine external replacements
  // (restore/AI/version load) are sent back into the editor; typing is never fed back.
  useEffect(() => {
    const normalizedContent = normalizeLiveMarkdownWhitespace(content);
    if (normalizedContent !== content) {
      editorMarkdownRef.current = normalizedContent;
      lastEmittedRef.current = normalizedContent;
      if (fallbackSource !== null) setFallbackSource(normalizedContent);
      else if (composingRef.current) pendingExternalContentRef.current = normalizedContent;
      else editorRef.current?.setMarkdown(normalizedContent);
      onChangeRef.current(normalizedContent);
      return;
    }
    if (content === lastEmittedRef.current) return;
    if (fallbackSource !== null) {
      setFallbackSource(content);
      editorMarkdownRef.current = content;
      lastEmittedRef.current = content;
      return;
    }
    const current = editorRef.current?.getMarkdown();
    if (current === undefined || current === content) return;
    if (composingRef.current) {
      pendingExternalContentRef.current = content;
      return;
    }
    editorMarkdownRef.current = content;
    lastEmittedRef.current = content;
    editorRef.current?.setMarkdown(content);
  }, [content, fallbackSource]);

  if (fallbackSource !== null) {
    return (
      <div className="live-markdown-editor live-markdown-fallback">
        <div className="markdown-fallback-notice" role="alert">
          <strong>원문 안전 편집</strong>
          <span>이 문서에는 라이브 편집기가 처리하지 못하는 구문이 있어 원문을 그대로 열었습니다.</span>
          {fallbackError ? <span className="markdown-fallback-detail">{fallbackError}</span> : null}
          <button
            type="button"
            className="btn btn-soft btn-compact"
            onClick={() => {
              setFallbackError("");
              setFallbackSource(null);
              setEditorRevision((revision) => revision + 1);
            }}
          >
            라이브 편집 다시 시도
          </button>
        </div>
        <textarea
          className="markdown-safe-source-input"
          aria-label="노트 원문 안전 편집"
          value={fallbackSource}
          maxLength={MAX_NOTE_CHARACTERS}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setFallbackSource(next);
            editorMarkdownRef.current = next;
            emitMarkdown(next);
          }}
          onSelect={(event) => {
            const target = event.currentTarget;
            onSelectionChangeRef.current?.(target.selectionStart, target.selectionEnd);
          }}
        />
        <div className="markdown-character-count" aria-live="polite">
          {fallbackSource.length.toLocaleString()} / {MAX_NOTE_CHARACTERS.toLocaleString()}
        </div>
      </div>
    );
  }

  return (
    <div
      className="live-markdown-editor"
      ref={rootRef}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
      onContextMenuCapture={captureSelection}
      onCompositionStartCapture={() => {
        composingRef.current = true;
        if (compositionFrameRef.current !== null) window.cancelAnimationFrame(compositionFrameRef.current);
      }}
      onCompositionEndCapture={() => {
        if (compositionFrameRef.current !== null) window.cancelAnimationFrame(compositionFrameRef.current);
        compositionFrameRef.current = window.requestAnimationFrame(() => {
          compositionFrameRef.current = null;
          composingRef.current = false;
          const committed = normalizeLiveMarkdownWhitespace(editorRef.current?.getMarkdown() ?? editorMarkdownRef.current);
          const pendingExternal = pendingExternalContentRef.current;
          pendingExternalContentRef.current = null;
          if (pendingExternal !== null && pendingExternal !== committed) {
            editorMarkdownRef.current = pendingExternal;
            lastEmittedRef.current = pendingExternal;
            editorRef.current?.setMarkdown(pendingExternal);
            captureSelection();
            return;
          }
          editorMarkdownRef.current = committed;
          emitMarkdown(committed);
          captureSelection();
        });
      }}
    >
      <EditorRuntimeBoundary
        key={editorRevision}
        onError={(error) => {
          const safeSource = editorMarkdownRef.current || content;
          setFallbackError(error.message || "라이브 편집기를 열지 못했습니다.");
          setFallbackSource(safeSource);
          emitMarkdown(safeSource);
        }}
      >
        <MDXEditor
          ref={editorRef}
          className="note-mdx-editor"
          contentEditableClassName="note-mdx-content"
          markdown={editorMarkdownRef.current}
          placeholder={placeholder}
          plugins={plugins}
          spellCheck
          suppressHtmlProcessing
          trim={false}
          translation={translateEditorMessage}
          onChange={(markdownValue, initialMarkdownNormalize) => {
            if (initialMarkdownNormalize) return;
            const normalizedMarkdown = normalizeLiveMarkdownWhitespace(markdownValue);
            editorMarkdownRef.current = normalizedMarkdown;
            if (composingRef.current) return;
            emitMarkdown(normalizedMarkdown);
          }}
          onError={({ error, source }) => {
            const safeSource = source || editorMarkdownRef.current || content;
            editorMarkdownRef.current = safeSource;
            setFallbackError(error);
            setFallbackSource(safeSource);
            emitMarkdown(safeSource);
          }}
        />
      </EditorRuntimeBoundary>
      <div className="markdown-character-count" aria-live="polite">
        {editorMarkdownRef.current.length.toLocaleString()} / {MAX_NOTE_CHARACTERS.toLocaleString()}
      </div>
    </div>
  );
}
