const STORAGE_KEY = "ai_usage_stats_v1";
const MAX_DAYS = 14;

export interface AiDailyUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AiUsageStats {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  /** 서버가 usage를 안 줘서 문자 수 기반 추정으로 기록된 요청 수 */
  estimatedRequests: number;
  daily: Record<string, AiDailyUsage>;
}

function emptyStats(): AiUsageStats {
  return { totalRequests: 0, promptTokens: 0, completionTokens: 0, estimatedRequests: 0, daily: {} };
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function getAiUsageStats(): AiUsageStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyStats();
    }
    const parsed = JSON.parse(raw) as Partial<AiUsageStats>;
    return {
      totalRequests: parsed.totalRequests ?? 0,
      promptTokens: parsed.promptTokens ?? 0,
      completionTokens: parsed.completionTokens ?? 0,
      estimatedRequests: parsed.estimatedRequests ?? 0,
      daily: parsed.daily ?? {},
    };
  } catch {
    return emptyStats();
  }
}

/** 한국어/영어 혼합 텍스트 기준 대략 3자 ≈ 1토큰으로 추정한다. */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 3));
}

export function recordAiUsage(entry: { promptTokens: number; completionTokens: number; estimated: boolean }): void {
  try {
    const stats = getAiUsageStats();
    stats.totalRequests += 1;
    stats.promptTokens += entry.promptTokens;
    stats.completionTokens += entry.completionTokens;
    if (entry.estimated) {
      stats.estimatedRequests += 1;
    }

    const key = todayKey();
    const day = stats.daily[key] ?? { requests: 0, promptTokens: 0, completionTokens: 0 };
    day.requests += 1;
    day.promptTokens += entry.promptTokens;
    day.completionTokens += entry.completionTokens;
    stats.daily[key] = day;

    // 오래된 일자 정리
    const keys = Object.keys(stats.daily).sort();
    while (keys.length > MAX_DAYS) {
      const oldest = keys.shift();
      if (oldest) {
        delete stats.daily[oldest];
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // 통계 기록 실패는 기능에 영향 주지 않는다
  }
}

export function resetAiUsage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getTodayUsage(stats: AiUsageStats): AiDailyUsage {
  return stats.daily[todayKey()] ?? { requests: 0, promptTokens: 0, completionTokens: 0 };
}
