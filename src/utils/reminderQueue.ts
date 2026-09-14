/** Remove only the acknowledged reminder, preserving concurrently queued IDs. */
export function removeReminder(params: URLSearchParams, taskId: string): URLSearchParams {
  const next = new URLSearchParams(params);
  const remaining = next.getAll("taskId").filter((id) => id !== taskId);
  next.delete("taskId");
  for (const id of remaining) next.append("taskId", id);
  if (!remaining.length) next.delete("review");
  return next;
}
