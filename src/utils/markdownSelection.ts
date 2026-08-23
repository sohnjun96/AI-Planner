export interface MarkdownSelectionRange {
  start: number;
  end: number;
}

function normalizeWithSourceOffsets(source: string): { value: string; offsets: number[] } {
  let value = "";
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      value += "\n";
      index += 1;
    } else {
      value += source[index];
    }
    offsets.push(index + 1);
  }
  return { value, offsets };
}

function uniqueRange(source: string, candidate: string): MarkdownSelectionRange | null {
  if (!candidate) return null;
  const normalizedSource = normalizeWithSourceOffsets(source);
  const normalizedCandidate = candidate.replace(/\r\n/g, "\n");
  const first = normalizedSource.value.indexOf(normalizedCandidate);
  if (first < 0 || normalizedSource.value.indexOf(normalizedCandidate, first + 1) >= 0) return null;
  return {
    start: normalizedSource.offsets[first] ?? 0,
    end: normalizedSource.offsets[first + normalizedCandidate.length] ?? source.length,
  };
}

/**
 * Maps a rich-editor selection back to raw Markdown only when the mapping is
 * unambiguous. Returning null is intentional: applying an AI edit to the wrong
 * duplicate phrase is worse than asking the user to use source mode.
 */
export function findMarkdownSelection(
  markdown: string,
  selectedMarkdown: string,
  selectedText: string,
): MarkdownSelectionRange | null {
  const candidates = [selectedText, selectedMarkdown, selectedMarkdown.replace(/^\n+|\n+$/g, "")];
  for (const candidate of candidates) {
    const range = uniqueRange(markdown, candidate);
    if (range) return range;
  }
  return null;
}
