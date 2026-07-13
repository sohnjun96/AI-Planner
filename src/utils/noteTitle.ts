const AUTO_TITLES = new Set(["", "새 노트", "제목 없는 노트", "제목 없음"]);

const MAX_TITLE_LENGTH = 50;

/** 사용자가 직접 정하지 않은 자동/기본 제목인지 판단한다. */
export function isAutoTitle(title: string): boolean {
  return AUTO_TITLES.has(title.trim());
}

/** 본문에서 첫 의미 있는 줄을 뽑아 제목으로 변환한다. */
export function deriveNoteTitle(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
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
  return Boolean(derived) && title.trim() === derived;
}
