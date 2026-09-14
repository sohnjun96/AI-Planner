import { useEffect } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import { showToast } from "../utils/toast";

export function RoutineNotifications() {
  const { rows, ready } = useRoutines();
  const { setting } = useAppData();
  const payload = JSON.stringify({ enabled: Boolean(setting.notificationsEnabled),
    items: rows.filter((row) => row.routine.isActive).map(({ routine, cycle }) => ({
      id: `${routine.id}:${cycle.period}:${cycle.notifyDate}`,
      when: new Date(`${cycle.notifyDate}T09:00:00`).getTime(),
    })) });
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
