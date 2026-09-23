import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import { RoutineReminder } from "./RoutineReminder";
import { WeeklyBackupReminder } from "./WeeklyBackupReminder";
import "./AppReminderStack.css";

export function AppReminderStack({ compact }: { compact: boolean }) {
  const { isReady } = useAppData();
  const { rows, ready } = useRoutines();
  const dueRows = isReady && ready ? rows.filter(({ cycle }) => cycle.needsAttention) : [];
  return <div className="app-reminder-stack">
    <RoutineReminder rows={dueRows} />
    <WeeklyBackupReminder compact={compact || dueRows.length > 0} />
  </div>;
}
