import { LUNCH_PROJECT_ID } from "../constants";
import type { Project, Task, TaskType } from "../models";
import type { LunchMateCandidate, LunchMateGroup } from "../agent/lunchMateAgent";
import { getDateKey } from "./date";

export type ArchivePeriod = "month" | "year" | "rolling" | "all";

const LUNCH_TITLE_PREFIX = /^\s*\((?:점|점심)\)\s*/i;
const IGNORED_LUNCH_NAMES = new Set(["", "혼자", "점심", "식사", "미정", "없음"]);

function normalizedPersonKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/님$/g, "")
    .toLocaleLowerCase("ko-KR");
}

function preferredPersonName(names: string[]): string {
  return [...names].sort((a, b) => b.replace(/\s/g, "").length - a.replace(/\s/g, "").length)[0] ?? "";
}

export function isLunchArchiveTask(
  task: Task,
  projectMap: Record<string, Project | undefined>,
  typeMap: Record<string, TaskType | undefined>,
): boolean {
  return (
    task.projectId === LUNCH_PROJECT_ID ||
    projectMap[task.projectId]?.name === "점심 약속" ||
    typeMap[task.taskTypeId]?.name === "식사" ||
    LUNCH_TITLE_PREFIX.test(task.title)
  );
}

export function isWorkArchiveTask(
  task: Task,
  projectMap: Record<string, Project | undefined>,
  typeMap: Record<string, TaskType | undefined>,
): boolean {
  const typeName = typeMap[task.taskTypeId]?.name ?? "";
  return !isLunchArchiveTask(task, projectMap, typeMap) && typeName !== "연가";
}

export function extractLunchMateCandidates(
  tasks: Task[],
  projectMap: Record<string, Project | undefined>,
  typeMap: Record<string, TaskType | undefined>,
): LunchMateCandidate[] {
  const rawCounts = new Map<string, number>();
  for (const task of tasks) {
    if (!isLunchArchiveTask(task, projectMap, typeMap)) {
      continue;
    }
    const names = task.title
      .replace(LUNCH_TITLE_PREFIX, "")
      .split(/\s*(?:\/|,|·|＆|&)\s*/)
      .map((name) => name.trim())
      .filter((name) => !IGNORED_LUNCH_NAMES.has(name));
    for (const name of new Set(names)) {
      rawCounts.set(name, (rawCounts.get(name) ?? 0) + 1);
    }
  }

  const machineGroups = new Map<string, { names: string[]; count: number }>();
  for (const [name, count] of rawCounts) {
    const key = normalizedPersonKey(name);
    if (!key) continue;
    const current = machineGroups.get(key) ?? { names: [], count: 0 };
    current.names.push(name);
    current.count += count;
    machineGroups.set(key, current);
  }
  return [...machineGroups.values()]
    .map((group) => ({ name: preferredPersonName(group.names), count: group.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

export function buildMachineLunchMateGroups(candidates: LunchMateCandidate[]): LunchMateGroup[] {
  return candidates.map((candidate) => ({
    displayName: candidate.name,
    aliases: [candidate.name],
    count: candidate.count,
    confidence: 1,
  }));
}

export function applyLunchMateAliasGroups(
  candidates: LunchMateCandidate[],
  aliasGroups: LunchMateGroup[] | undefined,
): LunchMateGroup[] {
  if (!aliasGroups || aliasGroups.length === 0) {
    return buildMachineLunchMateGroups(candidates);
  }
  const countByName = new Map(candidates.map((candidate) => [candidate.name, candidate.count]));
  const used = new Set<string>();
  const groups: LunchMateGroup[] = [];
  for (const aliasGroup of aliasGroups) {
    const aliases = aliasGroup.aliases.filter((alias) => countByName.has(alias));
    if (aliases.length === 0) continue;
    aliases.forEach((alias) => used.add(alias));
    groups.push({
      displayName: aliases.includes(aliasGroup.displayName)
        ? aliasGroup.displayName
        : preferredPersonName(aliases),
      aliases,
      count: aliases.reduce((sum, alias) => sum + (countByName.get(alias) ?? 0), 0),
      confidence: aliasGroup.confidence,
    });
  }
  for (const candidate of candidates) {
    if (!used.has(candidate.name)) {
      groups.push({
        displayName: candidate.name,
        aliases: [candidate.name],
        count: candidate.count,
        confidence: 1,
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, "ko"));
}

export function createLunchMateFingerprint(candidates: LunchMateCandidate[]): string {
  const source = [...candidates]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((candidate) => `${candidate.name}:${candidate.count}`)
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${candidates.length}-${(hash >>> 0).toString(16)}`;
}

export function isInArchivePeriod(value: string, period: ArchivePeriod, currentTime: number): boolean {
  if (period === "all") return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(currentTime);
  if (period === "month") {
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  }
  if (period === "year") {
    return date.getFullYear() === today.getFullYear();
  }
  const rangeStart = new Date(today);
  rangeStart.setHours(0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - 364);
  return date.getTime() >= rangeStart.getTime() && date.getTime() <= currentTime;
}

export function findPeakDay(tasks: Task[], dateSelector: (task: Task) => string): { key: string; count: number } | undefined {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = getDateKey(dateSelector(task));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || b.key.localeCompare(a.key))[0];
}
