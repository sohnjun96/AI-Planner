import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { getDateKey } from "../utils/date";
import { getRoutineCycle } from "../utils/routines";

export function useRoutines() {
  const routines = useLiveQuery(() => db.routines.toArray());
  const records = useLiveQuery(() => db.routineOccurrences.toArray());
  const [today, setToday] = useState(() => getDateKey(new Date()));
  useEffect(() => {
    const refresh = () => setToday(getDateKey(new Date()));
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const rows = useMemo(() => (routines ?? []).map((routine) => ({ routine, cycle: getRoutineCycle(routine, records ?? [], today) }))
    .sort((a, b) => a.cycle.notifyDate.localeCompare(b.cycle.notifyDate) || a.routine.title.localeCompare(b.routine.title)), [routines, records, today]);
  return { rows, records: records ?? [], ready: routines !== undefined && records !== undefined, today,
    dueCount: rows.filter((row) => row.cycle.needsAttention).length };
}
