import assert from "node:assert/strict";
import {
  applyMarkdownLineStyle,
  continueMarkdownLine,
  filterMarkdownSlashCommands,
  indentMarkdownLines,
  insertMarkdownTable,
  removeEmptyMarkdownPrefix,
  wrapMarkdownSelection,
} from "../src/utils/markdownEditing";

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
assert.equal(removeEmptyMarkdownPrefix("문장\n  - ", 7)?.value, "문장\n");
assert.equal(indentMarkdownLines("- 하나\n- 둘", 0, 8, false).value, "  - 하나\n  - 둘");
assert.equal(applyMarkdownLineStyle("하나\n둘", 0, 4, "ordered").value, "1. 하나\n2. 둘");
assert.equal(applyMarkdownLineStyle("제목", 0, 2, "heading3").value, "### 제목");
assert.equal(wrapMarkdownSelection("강조", 0, 2, "**", "**", "굵게").value, "**강조**");
assert.match(insertMarkdownTable("", 0, 0).value, /^\| 항목 \| 내용 \|\n\| --- \| --- \|/);
const slashCommands = [
  { id: "heading", label: "제목 1", description: "큰 제목", keywords: "h1" },
  { id: "table", label: "표", description: "표 삽입", keywords: "table" },
];
assert.deepEqual(filterMarkdownSlashCommands(slashCommands, "표").map((command) => command.id), ["table"]);
assert.equal(filterMarkdownSlashCommands(slashCommands, "", 1).length, 1);
process.stdout.write("Markdown editing checks passed.\n");
