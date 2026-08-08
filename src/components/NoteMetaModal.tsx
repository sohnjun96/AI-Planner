import { useState } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { NoteFormInput, NoteStatus, Project, ProjectSubcategory } from "../models";
import { ModalBackdrop } from "./ModalBackdrop";

interface NoteMetaModalProps {
  draft: NoteFormInput;
  projects: Project[];
  subcategories: ProjectSubcategory[];
  onApply: (patch: Partial<NoteFormInput>) => void;
  onClose: () => void;
}

const NOTE_STATUS_ORDER: NoteStatus[] = ["draft", "active", "archived"];

export function NoteMetaModal({ draft, projects, subcategories, onApply, onClose }: NoteMetaModalProps) {
  const [projectId, setProjectId] = useState(draft.projectId);
  const [subcategoryId, setSubcategoryId] = useState(draft.subcategoryId ?? "");
  const [status, setStatus] = useState<NoteStatus>(draft.status);
  const [isPinned, setIsPinned] = useState(draft.isPinned);
  const [tags, setTags] = useState<string[]>(draft.tags);
  const [tagDraft, setTagDraft] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose });

  const projectSubcategories = subcategories
    .filter((sub) => sub.projectId === projectId)
    .sort((a, b) => a.order - b.order);

  function commitTag() {
    const value = tagDraft.trim();
    if (value && !tags.includes(value)) {
      setTags((prev) => [...prev, value]);
    }
    setTagDraft("");
  }

  function handleApply() {
    onApply({
      projectId,
      subcategoryId: subcategoryId || undefined,
      status,
      isPinned,
      tags,
    });
    onClose();
  }

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="modal-card note-meta-modal"
        role="dialog"
        aria-modal="true"
        aria-label="노트 분류 수정"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <h2>분류 · 태그</h2>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        </header>

        <label className="note-modal-field">
          프로젝트
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setSubcategoryId("");
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label className="note-modal-field">
          세부 항목
          <select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
            <option value="">미분류</option>
            {projectSubcategories.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>
          {projectSubcategories.length === 0 ? (
            <small className="description-text">이 프로젝트에는 세부 항목이 없습니다. 프로젝트 설정에서 추가하세요.</small>
          ) : null}
        </label>

        <div className="note-modal-field">
          <span>상태</span>
          <div className="status-toggle-group" role="group" aria-label="노트 상태">
            {NOTE_STATUS_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                className={`status-toggle-btn ${status === value ? "active" : ""}`}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {NOTE_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="checkbox-inline">
          <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
          목록 상단에 고정
        </label>

        <div className="note-modal-field">
          <span>태그</span>
          <div className="note-tags-row">
            {tags.map((tag) => (
              <span key={tag} className="note-tag-chip">
                #{tag}
                <button type="button" aria-label={`${tag} 제거`} onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="note-tag-input"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTag();
                }
              }}
              onBlur={commitTag}
              placeholder="태그 추가"
            />
          </div>
        </div>

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={handleApply}>
            적용
          </button>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            취소
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
