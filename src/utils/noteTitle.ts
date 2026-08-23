const AUTO_TITLES = new Set(["", "새 노트", "제목 없는 노트", "제목 없음"]);

const MAX_TITLE_LENGTH = 50;

const TITLE_NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Markdown 렌더러가 문자로 표시하는 안전한 HTML 엔터티를 일반 텍스트에도 동일하게 반영한다. */
export function decodeMarkdownHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, encoded: string) => {
    const named = TITLE_NAMED_HTML_ENTITIES[encoded.toLowerCase()];
    if (named !== undefined) return named;

    const codePoint = encoded.toLowerCase().startsWith("#x")
      ? Number.parseInt(encoded.slice(2), 16)
      : Number.parseInt(encoded.slice(1), 10);
    if (
      !Number.isInteger(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return entity;
    }
    return String.fromCodePoint(codePoint);
  });
}

/** 사용자가 직접 정하지 않은 자동/기본 제목인지 판단한다. */
export function isAutoTitle(title: string): boolean {
  return AUTO_TITLES.has(title.trim());
}

/** 본문에서 첫 의미 있는 줄을 뽑아 제목으로 변환한다. */
export function deriveNoteTitle(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = decodeMarkdownHtmlEntities(line).trim();
    if (!trimmed) {
      continue;
    }
    const stripped = trimmed
      .replace(/^#{1,6}\s+/, "") // 제목 마크
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, "") // 체크리스트
      .replace(/^[-*+]\s+/, "") // 불릿
      .replace(/^>\s+/, "") // 인용
      .replace(/[*`_~]/g, "") // 강조 기호
      .trim();
    if (stripped) {
      return stripped.slice(0, MAX_TITLE_LENGTH);
    }
  }
  return "";
}

/**
 * 제목이 아직 "자동 따라가기" 상태인지 판단한다.
 * (기본 제목이거나, 직전 본문에서 파생한 제목과 동일하면 계속 따라간다)
 */
export function isFollowingTitle(title: string, previousContent: string): boolean {
  if (isAutoTitle(title)) {
    return true;
  }
  const derived = deriveNoteTitle(previousContent);
  return Boolean(derived) && decodeMarkdownHtmlEntities(title).trim() === derived;
}
