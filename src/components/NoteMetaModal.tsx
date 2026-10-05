import { useRef, useState } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { NoteFormInput, NoteStatus, Project, ProjectSubcategory } from "../models";
import { ModalBackdrop } from "./ModalBackdrop";

interface NoteMetaModalProps {
  draft: NoteFormInput;
  projects: Project[];
  subcategories: ProjectSubcategory[];
  onApply: (patch: Partial<NoteFormInput>) => Promise<void>;
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
  const [error, setError] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const applyingRef = useRef(false);
  const close = () => { if (!applyingRef.current) onClose(); };
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: close });

  const projectSubcategories = subcategories
    .filter((sub) => sub.projectId === projectId)
    .sort((a, b) => a.order - b.order);

  function commitTag() {
    const value = tagDraft.trim();
    if (value.length > 100 || (value && !tags.includes(value) && tags.length >= 50)) {
      setError("태그는 최대 50개, 각 100자까지 추가할 수 있습니다.");
      return;
    }
    if (value && !tags.includes(value)) {
      setTags((prev) => [...prev, value]);
    }
    setTagDraft("");
  }

  async function handleApply() {
    if (applyingRef.current) return;
    const nextTags = Array.from(new Set([...tags, tagDraft.trim()].filter(Boolean)));
    if (nextTags.length > 50 || nextTags.some((tag) => tag.length > 100)) {
      setError("태그는 최대 50개, 각 100자까지 추가할 수 있습니다.");
      return;
    }
    applyingRef.current = true;
    setIsApplying(true);
    setError("");
    try {
      await onApply({
      projectId,
      subcategoryId: subcategoryId || undefined,
      status,
      isPinned,
      tags: nextTags,
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "노트 분류를 저장하지 못했습니다.");
    } finally {
      applyingRef.current = false;
      setIsApplying(false);
    }
  }

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={close}>
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
          <button type="button" className="btn btn-soft" disabled={isApplying} onClick={close}>
            닫기
          </button>
        </header>

        <label className="note-modal-field">
          프로젝트
          <select
            disabled={isApplying}
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
          <select value={subcategoryId} disabled={isApplying} onChange={(event) => setSubcategoryId(event.target.value)}>
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
                disabled={isApplying}
                onClick={() => setStatus(value)}
              >
                {NOTE_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="checkbox-inline">
          <input type="checkbox" checked={isPinned} disabled={isApplying} onChange={(event) => setIsPinned(event.target.checked)} />
          목록 상단에 고정
        </label>

        <div className="note-modal-field">
          <span>태그</span>
          <div className="note-tags-row">
            {tags.map((tag) => (
              <span key={tag} className="note-tag-chip">
                #{tag}
                <button type="button" disabled={isApplying} aria-label={`${tag} 제거`} onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="note-tag-input"
              value={tagDraft}
              aria-label="태그 추가"
              aria-describedby="note-tag-limits"
              disabled={isApplying}
              maxLength={100}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  commitTag();
                }
              }}
              onBlur={commitTag}
              placeholder="태그 추가"
            />
          </div>
          <small id="note-tag-limits" className="description-text">최대 50개 · 태그당 100자</small>
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <div className="button-row">
          <button type="button" className="btn btn-primary" disabled={isApplying} onClick={() => void handleApply()}>
            {isApplying ? "저장 중…" : "적용"}
          </button>
          <button type="button" className="btn btn-soft" disabled={isApplying} onClick={close}>
            취소
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
