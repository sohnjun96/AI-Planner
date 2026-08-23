import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListType,
} from "@lexical/list";
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { createRootEditorSubscription$, realmPlugin } from "@mdxeditor/editor";
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_SPACE_COMMAND,
  type ElementNode,
  type LexicalEditor,
} from "lexical";

interface ListShortcut {
  type: ListType;
  start: number;
  checked?: boolean;
}

function parseListShortcut(marker: string): ListShortcut | undefined {
  if (/^[-*+]$/.test(marker)) return { type: "bullet", start: 1 };

  const ordered = marker.match(/^(\d{1,6})[.)]$/);
  if (ordered) {
    return {
      type: "number",
      start: Math.min(1_000_000, Math.max(1, Number(ordered[1]))),
    };
  }

  const checklist = marker.match(/^[-*+] \[([ xX]?)\]$/);
  if (checklist) {
    return { type: "check", start: 1, checked: checklist[1].toLowerCase() === "x" };
  }

  return undefined;
}

function replaceWithEmptyBlock(parent: ElementNode, replacement: ElementNode): void {
  parent.replace(replacement);
  replacement.selectStart();
}

function replaceWithEmptyList(parent: ElementNode, shortcut: ListShortcut): void {
  const list = $createListNode(shortcut.type, shortcut.start);
  const item = $createListItemNode();
  if (shortcut.type === "check") item.setChecked(shortcut.checked ?? false);
  list.append(item);
  parent.replace(list);
  item.selectStart();
}

function registerStableBlockShortcuts(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    KEY_SPACE_COMMAND,
    (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;

      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      if (!selection.anchor.is(selection.focus)) return false;

      const anchor = selection.anchor;
      const textNode = anchor.getNode();
      if (!$isTextNode(textNode) || anchor.offset !== textNode.getTextContentSize()) return false;

      const parent = textNode.getParent();
      const marker = textNode.getTextContent();
      const checklistItem = marker.match(/^\[([ xX]?)\]$/);
      if (
        checklistItem &&
        $isListItemNode(parent) &&
        parent.getChildrenSize() === 1 &&
        parent.getFirstChild() === textNode
      ) {
        const listParent = parent.getParent();
        if ($isListNode(listParent) && (listParent.getListType() === "bullet" || listParent.getListType() === "check")) {
          listParent.setListType("check");
          textNode.setTextContent("");
          parent.setChecked(checklistItem[1].toLowerCase() === "x");
          parent.selectStart();
          event.preventDefault();
          return true;
        }
      }

      if (
        !$isParagraphNode(parent) ||
        !$isRootOrShadowRoot(parent.getParent()) ||
        parent.getChildrenSize() !== 1 ||
        parent.getFirstChild() !== textNode
      ) {
        return false;
      }

      const heading = marker.match(/^(#{1,6})$/);
      const list = parseListShortcut(marker);

      if (heading) {
        replaceWithEmptyBlock(parent, $createHeadingNode(`h${heading[1].length}` as HeadingTagType));
      } else if (marker === ">") {
        replaceWithEmptyBlock(parent, $createQuoteNode());
      } else if (list) {
        replaceWithEmptyList(parent, list);
      } else {
        return false;
      }

      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/** IME 상태에서도 `# `, `- ` 같은 블록 단축 입력이 공백 직렬화보다 먼저 실행되게 한다. */
export const stableMarkdownShortcutsPlugin = realmPlugin({
  init(realm) {
    realm.pub(createRootEditorSubscription$, registerStableBlockShortcuts);
  },
});
