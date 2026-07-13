import type { Project } from "../models";

/**
 * 프로젝트 표시 순서 비교자.
 * 사용자가 드래그앤드롭으로 정한 order가 우선하고, order가 없는 항목은 이름순으로 뒤에 온다.
 * 프로젝트 탭·일정 폼 선택리스트 등 프로젝트를 나열하는 모든 곳에서 이 비교자를 쓴다.
 */
export function compareProjects(a: Project, b: Project): number {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.name.localeCompare(b.name, "ko");
}

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(compareProjects);
}
