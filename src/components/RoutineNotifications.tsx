import { useEffect, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import { showToast } from "../utils/toast";
import { createAutomaticRoutineTask } from "../utils/routineStore";

interface AutomaticCandidate {
  routineId: string;
  cycleId: string;
  key: string;
  title: string;
}

interface AutomaticAttempt {
  key: string;
  status: "pending" | "done" | "failed";
  retryVersion: number;
  repairToken: string;
}

export function RoutineNotifications() {
  const { rows, records, ready, today } = useRoutines();
  const { setting, isReady, projects, taskTypes, tasks } = useAppData();
  const attempts = useRef(new Map<string, AutomaticAttempt>());
  const [retryVersion, setRetryVersion] = useState(0);
  const automaticPayload = JSON.stringify(rows.filter(({ routine, cycle }) => routine.mode === "auto"
    && routine.isActive && !cycle.ended && cycle.needsAttention).map(({ routine, cycle }): AutomaticCandidate => ({
      routineId: routine.id, cycleId: cycle.id, title: routine.title,
      key: JSON.stringify([routine.updatedAt, cycle.id, cycle.notifyDate]),
    })));
  // Repairing a missing classification or freeing task capacity can recover a
  // failed attempt without waiting for the periodic retry.
  const repairToken = JSON.stringify([projects.map(({ id }) => id).sort(), taskTypes.map(({ id }) => id).sort(), tasks.length, records.length, today]);
  const payload = JSON.stringify({ enabled: Boolean(setting.notificationsEnabled),
    items: rows.filter((row) => row.routine.mode !== "auto" && row.routine.isActive && !row.cycle.ended && row.cycle.notifyDate).map(({ cycle }) => ({
      id: `${cycle.id}:${cycle.notifyDate}`,
      when: new Date(`${cycle.notifyDate}T09:00:00`).getTime(),
    })) });
  useEffect(() => {
    const retry = () => setRetryVersion((value) => value + 1);
    const onVisibility = () => { if (document.visibilityState === "visible") retry(); };
    const timer = window.setInterval(retry, 5 * 60_000);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (!ready || !isReady) return;
    const candidates: AutomaticCandidate[] = JSON.parse(automaticPayload);
    const eligibleIds = new Set(candidates.map(({ routineId }) => routineId));
    for (const id of attempts.current.keys()) if (!eligibleIds.has(id)) attempts.current.delete(id);
    for (const candidate of candidates) {
      const previous = attempts.current.get(candidate.routineId);
      if (previous?.key === candidate.key && (previous.status !== "failed"
        || (previous.retryVersion === retryVersion && previous.repairToken === repairToken))) continue;
      const attempt: AutomaticAttempt = { key: candidate.key, status: "pending", retryVersion, repairToken };
      attempts.current.set(candidate.routineId, attempt);
      void createAutomaticRoutineTask(candidate.routineId, candidate.cycleId).then(() => {
        attempt.status = "done";
      }).catch((error: unknown) => {
        attempt.status = "failed";
        const message = error instanceof Error ? error.message : "일정 저장 상태를 확인해 주세요.";
        showToast(`${candidate.title} 루틴의 일정을 자동으로 만들지 못했습니다. ${message}`, { tone: "error" });
      });
    }
  }, [automaticPayload, ready, isReady, retryVersion, repairToken]);
  useEffect(() => {
    const chromeApi = (globalThis as typeof globalThis & { chrome?: {
      storage?: { local?: { set: (value: Record<string, unknown>) => Promise<void> } };
    } }).chrome;
    if (!ready || !chromeApi?.storage?.local) return;
    void chromeApi.storage.local.set({ schedule_routine_payload_v1: JSON.parse(payload) }).catch(() => {
      showToast("루틴 알림을 예약하지 못했습니다. 대시보드에서 확인해 주세요.", { tone: "error" });
    });
  }, [payload, ready]);
  return null;
}
