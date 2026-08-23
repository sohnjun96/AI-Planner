import assert from "node:assert/strict";
import {
  applyMarkdownLineStyle,
  continueMarkdownLine,
  filterMarkdownSlashCommands,
  indentMarkdownLines,
  insertMarkdownLink,
  insertMarkdownTable,
  nextMarkdownListDepth,
  normalizeLiveMarkdownWhitespace,
  parseMarkdownChecklistItemShortcut,
  parseMarkdownListShortcut,
  removeEmptyMarkdownPrefix,
  toggleMarkdownSelection,
  wrapMarkdownSelection,
} from "../src/utils/markdownEditing";
import { findMarkdownSelection } from "../src/utils/markdownSelection";
import { decodeMarkdownHtmlEntities, deriveNoteTitle, isFollowingTitle } from "../src/utils/noteTitle";

assert.deepEqual(continueMarkdownLine("- 항목", 4, 4), {
  value: "- 항목\n- ",
  selectionStart: 7,
  selectionEnd: 7,
});

assert.deepEqual(continueMarkdownLine("- 항목\n- ", 7, 7), {
  value: "- 항목\n",
  selectionStart: 5,
  selectionEnd: 5,
});

assert.equal(continueMarkdownLine("- [x] 완료", 8, 8)?.value, "- [x] 완료\n- [ ] ");
assert.equal(continueMarkdownLine("3. 셋째", 5, 5)?.value, "3. 셋째\n4. ");
assert.equal(continueMarkdownLine("  - ", 4, 4)?.value, "- ");
assert.equal(continueMarkdownLine("  - [ ] ", 8, 8)?.value, "- [ ] ");
assert.equal(removeEmptyMarkdownPrefix("문장\n  - ", 7)?.value, "문장\n");
assert.equal(indentMarkdownLines("- 하나\n- 둘", 0, 8, false).value, "  - 하나\n  - 둘");
assert.equal(nextMarkdownListDepth(0, undefined, false), 0);
assert.equal(nextMarkdownListDepth(0, 0, false), 1);
assert.equal(nextMarkdownListDepth(1, 0, false), 1);
assert.equal(nextMarkdownListDepth(2, 1, true), 1);
assert.equal(nextMarkdownListDepth(8, 8, false), 4);
assert.deepEqual(parseMarkdownListShortcut("- "), { kind: "unordered", body: "" });
assert.deepEqual(parseMarkdownListShortcut("3. 항목"), { kind: "ordered", body: "항목", start: 3 });
assert.deepEqual(parseMarkdownListShortcut("- [x] 완료"), { kind: "checklist", body: "완료", checked: true });
assert.deepEqual(parseMarkdownChecklistItemShortcut("[ ] 할 일"), { body: "할 일", checked: false });
assert.equal(parseMarkdownListShortcut("일반 문장"), null);
assert.equal(applyMarkdownLineStyle("하나\n둘", 0, 4, "ordered").value, "1. 하나\n2. 둘");
assert.equal(applyMarkdownLineStyle("제목", 0, 2, "heading3").value, "### 제목");
assert.equal(wrapMarkdownSelection("강조", 0, 2, "**", "**", "굵게").value, "**강조**");
assert.deepEqual(toggleMarkdownSelection("**강조**", 2, 4, "**", "**", "굵게"), {
  value: "강조",
  selectionStart: 0,
  selectionEnd: 2,
});
assert.deepEqual(insertMarkdownLink("문서", 0, 2, "https://example.com/a_(b)"), {
  value: "[문서](https://example.com/a_(b))",
  selectionStart: 1,
  selectionEnd: 3,
});
assert.match(insertMarkdownTable("", 0, 0).value, /^\| 항목 \| 내용 \|\n\| --- \| --- \|/);
const slashCommands = [
  { id: "heading", label: "제목 1", description: "큰 제목", keywords: "h1" },
  { id: "table", label: "표", description: "표 삽입", keywords: "table" },
];
assert.deepEqual(filterMarkdownSlashCommands(slashCommands, "표").map((command) => command.id), ["table"]);
assert.equal(filterMarkdownSlashCommands(slashCommands, "", 1).length, 1);
assert.equal(
  normalizeLiveMarkdownWhitespace("제목&#x20;\n&#32;- 항목&nbsp;"),
  "제목 \n - 항목 ",
);
assert.equal(
  normalizeLiveMarkdownWhitespace("`&#x20;` 바깥&#x20;\n```md\n코드&#x20;\n```\n끝&#32;"),
  "`&#x20;` 바깥 \n```md\n코드&#x20;\n```\n끝 ",
);
assert.deepEqual(findMarkdownSelection("앞 **강조** 뒤", "**강조**", "강조"), { start: 4, end: 6 });
assert.deepEqual(findMarkdownSelection("첫 줄\r\n둘째 줄", "둘째 줄", "둘째 줄"), { start: 5, end: 9 });
assert.equal(findMarkdownSelection("반복 문장과 반복 문장", "반복 문장", "반복 문장"), null);
assert.equal(deriveNoteTitle("AI 특허심사&#x20;\n본문"), "AI 특허심사");
assert.equal(deriveNoteTitle("## **개요&nbsp;**"), "개요");
assert.equal(isFollowingTitle("AI 특허심사&#x20;", "AI 특허심사&#x20;"), true);
assert.equal(decodeMarkdownHtmlEntities("AI 특허심사&#x20;&amp; 검토"), "AI 특허심사 & 검토");
process.stdout.write("Markdown editing checks passed.\n");
