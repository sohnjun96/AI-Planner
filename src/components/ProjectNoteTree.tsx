import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { Note, Project, ProjectSubcategory } from "../models";

export type NoteFilterNode =
  | { kind: "all" }
  | { kind: "pinned" }
  | { kind: "checklist" }
  | { kind: "archived" }
  | { kind: "project"; projectId: string }
  | { kind: "subcategory"; projectId: string; subcategoryId: string }
  | { kind: "uncategorized"; projectId: string };

interface ProjectNoteTreeProps {
  projects: Project[];
  subcategories: ProjectSubcategory[];
  notes: Note[];
  openChecklistCount: number;
  selected: NoteFilterNode;
  onSelect: (node: NoteFilterNode) => void;
  onAddSubcategory: (projectId: string, name: string) => Promise<void>;
}

export function ProjectNoteTree({ projects, subcategories, notes, openChecklistCount, selected, onSelect, onAddSubcategory }: ProjectNoteTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const note of notes) {
      set.add(note.projectId);
    }
    return set;
  });
  const [addingProjectId, setAddingProjectId] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const addingRef = useRef(false);

  const counts = useMemo(() => {
    const project = new Map<string, number>();
    const sub = new Map<string, number>();
    const uncategorized = new Map<string, number>();
    let pinned = 0;
    let archived = 0;
    for (const note of notes) {
      // 보관된 노트는 별도 보관함에서만 집계 — 목록 카운트와 일치시킨다
      if (note.status === "archived") {
        archived += 1;
        continue;
      }
      project.set(note.projectId, (project.get(note.projectId) ?? 0) + 1);
      if (note.subcategoryId) {
        sub.set(note.subcategoryId, (sub.get(note.subcategoryId) ?? 0) + 1);
      } else {
        uncategorized.set(note.projectId, (uncategorized.get(note.projectId) ?? 0) + 1);
      }
      if (note.isPinned) {
        pinned += 1;
      }
    }
    return { project, sub, uncategorized, pinned, archived };
  }, [notes]);

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name, "ko")), [projects]);

  function toggleExpand(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  async function submitAdd(projectId: string) {
    if (addingRef.current) return;
    const value = addName.trim();
    if (!value || value.length > 200) {
      setAddError("세부 항목 이름을 1~200자로 입력하세요.");
      return;
    }
    addingRef.current = true;
    setIsAdding(true);
    setAddError("");
    try {
      await onAddSubcategory(projectId, value);
      setAddName("");
      setAddingProjectId(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "세부 항목을 추가하지 못했습니다.");
    } finally {
      addingRef.current = false;
      setIsAdding(false);
    }
  }

  return (
    <nav className="note-tree" aria-label="프로젝트별 노트">
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "all" ? "active" : ""}`}
        aria-current={selected.kind === "all" || undefined}
        onClick={() => onSelect({ kind: "all" })}
      >
        <span className="note-tree-label">전체 노트</span>
        <span className="note-tree-count">{notes.length - counts.archived}</span>
      </button>
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "pinned" ? "active" : ""}`}
        aria-current={selected.kind === "pinned" || undefined}
        onClick={() => onSelect({ kind: "pinned" })}
      >
        <span className="note-tree-label">고정됨</span>
        <span className="note-tree-count">{counts.pinned}</span>
      </button>
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "checklist" ? "active" : ""}`}
        aria-current={selected.kind === "checklist" || undefined}
        onClick={() => onSelect({ kind: "checklist" })}
      >
        <span className="note-tree-label">체크리스트</span>
        <span className="note-tree-count">{openChecklistCount}</span>
      </button>

      <div className="note-tree-divider" />

      {sortedProjects.map((project) => {
        const isOpen = expanded.has(project.id);
        const projectSubs = subcategories
          .filter((sub) => sub.projectId === project.id)
          .sort((a, b) => a.order - b.order);
        const uncat = counts.uncategorized.get(project.id) ?? 0;

        return (
          <div key={project.id} className="note-tree-project">
            <div className={`note-tree-row project ${selected.kind === "project" && selected.projectId === project.id ? "active" : ""}`}>
              <button
                type="button"
                className="note-tree-expander"
                aria-label={`${project.name} ${isOpen ? "접기" : "펼치기"}`}
                aria-expanded={isOpen}
                aria-controls={`note-project-children-${project.id}`}
                onClick={() => toggleExpand(project.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <button
                type="button"
                className="note-tree-project-name"
                aria-current={(selected.kind === "project" && selected.projectId === project.id) || undefined}
                onClick={() => onSelect({ kind: "project", projectId: project.id })}
                style={{ "--note-project-color": project.color } as CSSProperties}
              >
                <span className="note-tree-dot" />
                <span className="note-tree-label">{project.name}</span>
                <span className="note-tree-count">{counts.project.get(project.id) ?? 0}</span>
              </button>
              <button
                type="button"
                className="note-tree-project-more"
                aria-label={`${project.name} 세부 항목 추가`}
                title="세부 항목 추가"
                disabled={isAdding}
                onClick={() => {
                  setAddingProjectId(project.id);
                  setAddName("");
                  setAddError("");
                  if (!isOpen) {
                    toggleExpand(project.id);
                  }
                }}
              >
                ⋯
              </button>
            </div>

            {isOpen ? (
              <div className="note-tree-children" id={`note-project-children-${project.id}`}>
                {projectSubs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={`note-tree-row child ${
                      selected.kind === "subcategory" && selected.subcategoryId === sub.id ? "active" : ""
                    }`}
                    onClick={() => onSelect({ kind: "subcategory", projectId: project.id, subcategoryId: sub.id })}
                    aria-current={(selected.kind === "subcategory" && selected.subcategoryId === sub.id) || undefined}
                  >
                    <span className="note-tree-label">{sub.name}</span>
                    <span className="note-tree-count">{counts.sub.get(sub.id) ?? 0}</span>
                  </button>
                ))}
                {uncat > 0 ? (
                  <button
                    type="button"
                    className={`note-tree-row child muted ${
                      selected.kind === "uncategorized" && selected.projectId === project.id ? "active" : ""
                    }`}
                    onClick={() => onSelect({ kind: "uncategorized", projectId: project.id })}
                    aria-current={(selected.kind === "uncategorized" && selected.projectId === project.id) || undefined}
                  >
                    <span className="note-tree-label">미분류</span>
                    <span className="note-tree-count">{uncat}</span>
                  </button>
                ) : null}

                {addingProjectId === project.id ? (
                  <div className="note-tree-add-form"><input
                    className="note-tree-add-input"
                    value={addName}
                    aria-label={`${project.name} 세부 항목 이름`}
                    disabled={isAdding}
                    maxLength={200}
                    autoFocus
                    onChange={(event) => setAddName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        void submitAdd(project.id);
                      }
                      if (event.key === "Escape" && !isAdding) {
                        setAddingProjectId(null);
                        setAddName("");
                      }
                    }}
                    placeholder="세부 항목 이름"
                  /><small className="description-text">최대 200자</small>{addError ? <p className="error-text" role="alert">{addError}</p> : null}<div className="button-row"><button type="button" className="btn btn-primary btn-compact" disabled={isAdding} onClick={() => void submitAdd(project.id)}>{isAdding ? "추가 중…" : "추가"}</button><button type="button" className="btn btn-soft btn-compact" disabled={isAdding} onClick={() => setAddingProjectId(null)}>취소</button></div></div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="note-tree-divider" />

      <button
        type="button"
        className={`note-tree-row root muted ${selected.kind === "archived" ? "active" : ""}`}
        aria-current={selected.kind === "archived" || undefined}
        onClick={() => onSelect({ kind: "archived" })}
      >
        <span className="note-tree-label">보관됨</span>
        <span className="note-tree-count">{counts.archived}</span>
      </button>
    </nav>
  );
}
