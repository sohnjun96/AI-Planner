export type DiffLineType = "equal" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

/**
 * LCS(최장 공통 부분수열) 기반 라인 단위 diff.
 * 외부 의존성 없이 두 텍스트를 비교해 add/remove/equal 라인 배열을 반환한다.
 */
export function diffLines(previous: string, next: string): DiffLine[] {
  const a = splitLines(previous);
  const b = splitLines(next);
  const rows = a.length;
  const cols = b.length;

  // LCS 길이 테이블 (rows+1) x (cols+1)
  const lcs: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      result.push({ type: "equal", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: "remove", text: a[i] });
      i += 1;
    } else {
      result.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ type: "remove", text: a[i] });
    i += 1;
  }
  while (j < cols) {
    result.push({ type: "add", text: b[j] });
    j += 1;
  }

  return result;
}

export function summarizeDiff(lines: DiffLine[]): DiffStats {
  return lines.reduce<DiffStats>(
    (stats, line) => {
      if (line.type === "add") {
        stats.added += 1;
      } else if (line.type === "remove") {
        stats.removed += 1;
      }
      return stats;
    },
    { added: 0, removed: 0 },
  );
}

export function hasChanges(previous: string, next: string): boolean {
  return previous.replace(/\r\n/g, "\n") !== next.replace(/\r\n/g, "\n");
}
