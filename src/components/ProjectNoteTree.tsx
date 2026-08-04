import { useMemo, useState, type CSSProperties } from "react";
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
  onAddSubcategory: (projectId: string, name: string) => void;
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

  function submitAdd(projectId: string) {
    const value = addName.trim();
    if (value) {
      onAddSubcategory(projectId, value);
    }
    setAddName("");
    setAddingProjectId(null);
  }

  return (
    <nav className="note-tree" aria-label="프로젝트별 노트">
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "all" ? "active" : ""}`}
        onClick={() => onSelect({ kind: "all" })}
      >
        <span className="note-tree-label">전체 노트</span>
        <span className="note-tree-count">{notes.length - counts.archived}</span>
      </button>
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "pinned" ? "active" : ""}`}
        onClick={() => onSelect({ kind: "pinned" })}
      >
        <span className="note-tree-label">📌 고정됨</span>
        <span className="note-tree-count">{counts.pinned}</span>
      </button>
      <button
        type="button"
        className={`note-tree-row root ${selected.kind === "checklist" ? "active" : ""}`}
        onClick={() => onSelect({ kind: "checklist" })}
      >
        <span className="note-tree-label">✓ 전체 체크리스트</span>
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
                aria-label={isOpen ? "접기" : "펼치기"}
                onClick={() => toggleExpand(project.id)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <button
                type="button"
                className="note-tree-project-name"
                onClick={() => onSelect({ kind: "project", projectId: project.id })}
                style={{ "--note-project-color": project.color } as CSSProperties}
              >
                <span className="note-tree-dot" />
                <span className="note-tree-label">{project.name}</span>
                <span className="note-tree-count">{counts.project.get(project.id) ?? 0}</span>
              </button>
            </div>

            {isOpen ? (
              <div className="note-tree-children">
                {projectSubs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    className={`note-tree-row child ${
                      selected.kind === "subcategory" && selected.subcategoryId === sub.id ? "active" : ""
                    }`}
                    onClick={() => onSelect({ kind: "subcategory", projectId: project.id, subcategoryId: sub.id })}
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
                  >
                    <span className="note-tree-label">미분류</span>
                    <span className="note-tree-count">{uncat}</span>
                  </button>
                ) : null}

                {addingProjectId === project.id ? (
                  <input
                    className="note-tree-add-input"
                    value={addName}
                    autoFocus
                    onChange={(event) => setAddName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitAdd(project.id);
                      }
                      if (event.key === "Escape") {
                        setAddingProjectId(null);
                        setAddName("");
                      }
                    }}
                    onBlur={() => submitAdd(project.id)}
                    placeholder="세부 항목 이름"
                  />
                ) : (
                  <button
                    type="button"
                    className="note-tree-add"
                    onClick={() => {
                      setAddingProjectId(project.id);
                      setAddName("");
                    }}
                  >
                    + 세부 항목
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="note-tree-divider" />

      <button
        type="button"
        className={`note-tree-row root muted ${selected.kind === "archived" ? "active" : ""}`}
        onClick={() => onSelect({ kind: "archived" })}
      >
        <span className="note-tree-label">🗄 보관됨</span>
        <span className="note-tree-count">{counts.archived}</span>
      </button>
    </nav>
  );
}
