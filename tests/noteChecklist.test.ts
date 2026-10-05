import assert from "node:assert/strict";
import { readNoteChecklist, setNoteChecklistItem } from "../src/utils/noteChecklist";

const source = "```md\n- [ ] 코드 예시\n```\n\n- [ ] 첫 항목\n1. [ ] 번호 항목\n> - [ ] 인용 항목\n\n    - [ ] 들여쓰기 코드\n";
assert.deepEqual(readNoteChecklist(source).map((item) => item.text), ["첫 항목", "번호 항목", "인용 항목"]);
assert.throws(() => setNoteChecklistItem(source, 1, true), /항목이 변경/);
const first = setNoteChecklistItem(source, 4, true);
const both = setNoteChecklistItem(first, 5, true);
assert.deepEqual(readNoteChecklist(both).map((item) => item.checked), [true, true, false]);
assert.ok(both.includes("- [ ] 코드 예시"));
assert.equal(setNoteChecklistItem("- [ ] A\r\n- [ ] B\r\n", 1, true), "- [ ] A\r\n- [x] B\r\n");
process.stdout.write("Note checklist syntax and source preservation checks passed.\n");
