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
import { findMarkdownSelection, findMarkdownSourceSelection } from "../src/utils/markdownSelection";
import { decodeMarkdownHtmlEntities, deriveNoteTitle, isFollowingTitle } from "../src/utils/noteTitle";
import { diffLines, diffWordsDetailed, summarizeDiff } from "../src/utils/lineDiff";
import { defaultNoteActionWhen, validateNoteAction } from "../src/utils/noteActionValidation";

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

// Code content and URL syntax must survive live serialization normalization.
for (const code of [
  '    const literal = "&nbsp;";',
  '> ```html\n> &nbsp;\n> ```',
  '- 코드\n\n  ```html\n  &#32;\n  ```',
  '`first\n&nbsp;\nlast`',
  '`` literal ` &nbsp; ``',
  '<code>&nbsp;</code>',
  '[링크](https://example.com/?q=&nbsp;)',
]) assert.equal(normalizeLiveMarkdownWhitespace(code), code);
assert.equal(normalizeLiveMarkdownWhitespace('    &nbsp;\r\n\r\n바깥&nbsp;'), '    &nbsp;\r\n\r\n바깥 ');

// Source offsets identify a particular duplicate, including CRLF source data.
assert.deepEqual(findMarkdownSourceSelection('반복 문장\n반복 문장', 6, 11), { start: 6, end: 11 });
assert.deepEqual(findMarkdownSourceSelection('반복 문장\r\n반복 문장', 6, 11), { start: 7, end: 12 });
assert.deepEqual(findMarkdownSourceSelection('반복 문장', 5, 1), { start: 1, end: 5 });

// Empty or impossible dates must report a field error without throwing.
assert.equal(validateNoteAction('정상', '').startAtIso, undefined);
assert.ok(validateNoteAction('정상', '').whenError);
assert.ok(validateNoteAction('정상', '2026-02-30T09:00').whenError);
assert.ok(validateNoteAction(' ', '2026-10-06T09:00').titleError);
assert.ok(validateNoteAction('a'.repeat(501), '2026-10-06T09:00').titleError);
const validAction = validateNoteAction('검토', '2026-10-06T09:00');
assert.equal(validAction.whenError, undefined);
assert.equal(validAction.startAtIso, new Date('2026-10-06T09:00').toISOString());
assert.equal(defaultNoteActionWhen(undefined, new Date('2026-10-05T14:00')), '2026-10-06T09:00');
assert.equal(defaultNoteActionWhen(undefined, new Date('2026-10-05T08:00')), '2026-10-05T09:00');
assert.equal(defaultNoteActionWhen('2026-10-08', new Date('2026-10-05T14:00')), '2026-10-08T09:00');

function assertFaithfulDiff(previous: string, next: string) {
  const result = diffWordsDetailed(previous, next);
  assert.equal(result.tokens.filter((part) => part.type !== 'add').map((part) => part.text).join(''), previous.replace(/\r\n/g, '\n'));
  assert.equal(result.tokens.filter((part) => part.type !== 'remove').map((part) => part.text).join(''), next.replace(/\r\n/g, '\n'));
  return result;
}
assertFaithfulDiff('첫 문장\n둘째 문장', '첫 변경\n둘째 문장');
assert.deepEqual(summarizeDiff(diffLines('a\nb\nc', 'a\nB\nc')), { added: 1, removed: 1 });
const largeSource = Array.from({ length: 20_000 }, (_, index) => `word${index}`).join(' ');
const scatteredEdits = largeSource.replace('word10 ', 'changed10 ').replace('word19990 ', 'changed19990 ');
const largeDiff = assertFaithfulDiff(largeSource, scatteredEdits);
assert.equal(largeDiff.isCoarse, false);
assert.ok(largeDiff.tokens.length < 20, 'Unchanged words should not create thousands of DOM nodes.');
const coarse = assertFaithfulDiff('old '.repeat(20_000), 'new '.repeat(20_000));
assert.equal(coarse.isCoarse, true);
assert.ok(coarse.tokens.length <= 3, 'Large repeated replacements must use bounded block comparison.');
assert.deepEqual(diffWordsDetailed(largeSource, largeSource), { tokens: [{ type: 'equal', text: largeSource }], isCoarse: false });
process.stdout.write("Markdown editing checks passed.\n");
