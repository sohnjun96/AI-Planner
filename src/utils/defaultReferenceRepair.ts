import { DEFAULT_PROJECTS, DEFAULT_TASK_TYPES } from "../constants";
import type { Project, TaskType, UserContext } from "../models";

interface NamedEntity {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciledDefaultReferences {
  projects: Project[];
  taskTypes: TaskType[];
  userContexts: UserContext[];
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function createReferenceResolver<T extends NamedEntity>(
  entities: T[],
  defaults: readonly T[],
  timestamp: string,
): (referenceId: string | undefined) => string | undefined {
  const ids = new Set(entities.map((entity) => entity.id));
  const entitiesByName = new Map(entities.map((entity) => [normalizeName(entity.name), entity]));
  const defaultsById = new Map(defaults.map((entity) => [entity.id, entity]));

  return (referenceId) => {
    if (referenceId === undefined || ids.has(referenceId)) return referenceId;

    const defaultEntity = defaultsById.get(referenceId);
    if (!defaultEntity) return referenceId;

    const sameNameEntity = entitiesByName.get(normalizeName(defaultEntity.name));
    if (sameNameEntity) return sameNameEntity.id;

    const restoredEntity = {
      ...defaultEntity,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as T;
    entities.push(restoredEntity);
    ids.add(restoredEntity.id);
    entitiesByName.set(normalizeName(restoredEntity.name), restoredEntity);
    return restoredEntity.id;
  };
}

/**
 * 구버전에서 이름 기반으로 생성된 기본 프로젝트·일정 종류와 현재 고정 ID 규칙을 연결한다.
 * 알려진 기본 ID만 복구하며, 사용자 정의 항목의 끊어진 참조는 검증 단계에서 계속 거부한다.
 */
export function reconcileDefaultUserContextReferences(
  projects: readonly Project[],
  taskTypes: readonly TaskType[],
  userContexts: readonly UserContext[],
  timestamp: string,
): ReconciledDefaultReferences {
  const nextProjects = [...projects];
  const nextTaskTypes = [...taskTypes];
  const resolveProjectId = createReferenceResolver(nextProjects, DEFAULT_PROJECTS, timestamp);
  const resolveTaskTypeId = createReferenceResolver(nextTaskTypes, DEFAULT_TASK_TYPES, timestamp);

  const nextUserContexts = userContexts.map((context) => {
    let changed = false;
    const rules = context.rules.map((rule) => {
      const projectId = resolveProjectId(rule.projectId);
      const taskTypeId = resolveTaskTypeId(rule.taskTypeId);
      if (projectId === rule.projectId && taskTypeId === rule.taskTypeId) return rule;
      changed = true;
      return { ...rule, projectId, taskTypeId };
    });
    return changed ? { ...context, rules, updatedAt: timestamp } : context;
  });

  return {
    projects: nextProjects,
    taskTypes: nextTaskTypes,
    userContexts: nextUserContexts,
  };
}
