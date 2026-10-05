export type DiffLineType = "equal" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export type DiffTokenType = DiffLineType;
export type DiffToken = DiffLine;

interface SequenceDiff {
  parts: DiffLine[];
  isCoarse: boolean;
}

// At most 4 MiB of typed-array LCS storage, shared across all changed regions.
const MAX_LCS_CELLS = 1_000_000;
const MAX_ANCHOR_DEPTH = 6;

/** Unique common tokens, kept in order via a longest-increasing-subsequence pass. */
function findAnchors(a: string[], b: string[], aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const left = new Map<string, number>();
  const right = new Map<string, number>();
  for (let i = aStart; i < aEnd; i += 1) left.set(a[i], left.has(a[i]) ? -1 : i);
  for (let i = bStart; i < bEnd; i += 1) {
    if (left.get(b[i]) !== undefined && left.get(b[i]) !== -1) right.set(b[i], right.has(b[i]) ? -1 : i);
  }
  const pairs: { a: number; b: number }[] = [];
  for (const [text, index] of left) {
    const other = right.get(text);
    if (index !== -1 && other !== undefined && other !== -1) pairs.push({ a: index, b: other });
  }
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  pairs.forEach((pair, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (pairs[tails[middle]].b < pair.b) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const anchors: { a: number; b: number }[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor !== -1) {
    anchors.push(pairs[cursor]);
    cursor = previous[cursor];
  }
  return anchors.reverse();
}

/**
 * Patience anchors split large documents into changed regions. Small regions use
 * bounded LCS; unanchored large regions use a faithful remove/add block instead
 * of allocating a quadratic matrix. Word results are grouped to bound DOM nodes.
 */
function diffSequence(a: string[], b: string[], groupWords: boolean): SequenceDiff {
  const parts: DiffLine[] = [];
  let remainingCells = MAX_LCS_CELLS;
  let isCoarse = false;
  const append = (type: DiffLineType, text: string) => {
    const last = parts.at(-1);
    if (groupWords && last?.type === type) last.text += text;
    else parts.push({ type, text });
  };
  const appendRange = (type: DiffLineType, source: string[], start: number, end: number) => {
    if (groupWords && start < end) append(type, source.slice(start, end).join(""));
    else for (let i = start; i < end; i += 1) append(type, source[i]);
  };

  const compare = (aStart: number, aEnd: number, bStart: number, bEnd: number, depth: number): void => {
    const prefixStart = aStart;
    while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
      aStart += 1;
      bStart += 1;
    }
    appendRange("equal", a, prefixStart, aStart);
    const suffixEnd = aEnd;
    while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd -= 1;
      bEnd -= 1;
    }
    const rows = aEnd - aStart;
    const cols = bEnd - bStart;
    const cells = (rows + 1) * (cols + 1);
    if (!rows) appendRange("add", b, bStart, bEnd);
    else if (!cols) appendRange("remove", a, aStart, aEnd);
    else if (cells <= remainingCells) {
      remainingCells -= cells;
      const stride = cols + 1;
      const lcs = new Uint32Array(cells);
      for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
          lcs[i * stride + j] = a[aStart + i] === b[bStart + j]
            ? lcs[(i + 1) * stride + j + 1] + 1
            : Math.max(lcs[(i + 1) * stride + j], lcs[i * stride + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < rows && j < cols) {
        if (a[aStart + i] === b[bStart + j]) {
          append("equal", a[aStart + i]);
          i += 1;
          j += 1;
        } else if (lcs[(i + 1) * stride + j] >= lcs[i * stride + j + 1]) {
          append("remove", a[aStart + i++]);
        } else append("add", b[bStart + j++]);
      }
      appendRange("remove", a, aStart + i, aEnd);
      appendRange("add", b, bStart + j, bEnd);
    } else {
      const anchors = depth < MAX_ANCHOR_DEPTH ? findAnchors(a, b, aStart, aEnd, bStart, bEnd) : [];
      if (anchors.length) {
        let left = aStart;
        let right = bStart;
        for (const anchor of anchors) {
          compare(left, anchor.a, right, anchor.b, depth + 1);
          append("equal", a[anchor.a]);
          left = anchor.a + 1;
          right = anchor.b + 1;
        }
        compare(left, aEnd, right, bEnd, depth + 1);
      } else {
        isCoarse = true;
        appendRange("remove", a, aStart, aEnd);
        appendRange("add", b, bStart, bEnd);
      }
    }
    appendRange("equal", a, aEnd, suffixEnd);
  };
  compare(0, a.length, 0, b.length, 0);
  return { parts, isCoarse };
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(previous: string, next: string): DiffLine[] {
  return diffSequence(splitLines(previous), splitLines(next), false).parts;
}

export function summarizeDiff(lines: DiffLine[]): DiffStats {
  return lines.reduce<DiffStats>((stats, line) => {
    if (line.type === "add") stats.added += 1;
    else if (line.type === "remove") stats.removed += 1;
    return stats;
  }, { added: 0, removed: 0 });
}

export function hasChanges(previous: string, next: string): boolean {
  return previous.replace(/\r\n/g, "\n") !== next.replace(/\r\n/g, "\n");
}

function tokenize(value: string): string[] {
  return value.replace(/\r\n/g, "\n").match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
}

export function diffWordsDetailed(previous: string, next: string): { tokens: DiffToken[]; isCoarse: boolean } {
  if (!hasChanges(previous, next)) {
    return { tokens: previous ? [{ type: "equal", text: previous.replace(/\r\n/g, "\n") }] : [], isCoarse: false };
  }
  const result = diffSequence(tokenize(previous), tokenize(next), true);
  return { tokens: result.parts, isCoarse: result.isCoarse };
}

export function diffWords(previous: string, next: string): DiffToken[] {
  return diffWordsDetailed(previous, next).tokens;
}
