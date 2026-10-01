import { useId, useRef, useState, type FormEvent } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { Project, TaskType } from "../models";
import { sortProjects } from "../utils/projectOrder";
import type { ScheduleBoardFilters } from "../utils/scheduleBoardFilters";
import { ModalBackdrop } from "./ModalBackdrop";
import "./ScheduleBoardFilterModal.css";

interface ScheduleBoardFilterModalProps {
  projects: Project[];
  taskTypes: TaskType[];
  filters: ScheduleBoardFilters;
  onApply: (filters: ScheduleBoardFilters) => void;
  onClose: () => void;
}

interface FilterSelectionGroupProps {
  title: string;
  items: Array<Pick<Project, "id" | "name" | "isActive">>;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}

function FilterSelectionGroup({ title, items, selectedIds, onChange }: FilterSelectionGroupProps) {
  return (
    <fieldset className="schedule-board-filter-group" aria-label={title}>
      <legend>
        {title}
        <span className="schedule-board-filter-selection-count">
          {selectedIds.length > 0 ? `${selectedIds.length}개 선택` : "전체 표시"}
        </span>
      </legend>
      <div className="schedule-board-filter-group-toolbar">
        <p>선택하지 않으면 모든 종류를 표시합니다.</p>
        {selectedIds.length > 0 ? (
          <button type="button" className="btn btn-soft" onClick={() => onChange([])}>
            전체 해제
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="schedule-board-filter-options">
          {items.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <label
                key={item.id}
                className={`schedule-board-filter-option${isSelected ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  aria-label={item.name}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selectedIds, item.id]
                        : selectedIds.filter((id) => id !== item.id),
                    )
                  }
                />
                <span className="schedule-board-filter-option-name">{item.name}</span>
                {!item.isActive ? <small className="schedule-board-filter-inactive">(비활성)</small> : null}
              </label>
            );
          })}
        </div>
      ) : (
        <p className="schedule-board-filter-empty">등록된 종류가 없습니다.</p>
      )}
    </fieldset>
  );
}

export function ScheduleBoardFilterModal({
  projects,
  taskTypes,
  filters,
  onApply,
  onClose,
}: ScheduleBoardFilterModalProps) {
  const [draft, setDraft] = useState<ScheduleBoardFilters>(() => ({
    taskTypeIds: [...filters.taskTypeIds],
    projectIds: [...filters.projectIds],
    keyword: filters.keyword,
  }));
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose, initialFocusRef: searchRef });
  const id = useId();
  const orderedTaskTypes = [...taskTypes].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...draft, keyword: draft.keyword.trim() });
  }

  return (
    <ModalBackdrop className="modal-backdrop schedule-board-filter-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="schedule-board-filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        tabIndex={-1}
      >
        <header className="schedule-board-filter-header">
          <h2 id={`${id}-title`}>일정 보드 필터</h2>
          <button type="button" className="btn btn-soft" onClick={onClose} aria-label="일정 보드 필터 닫기">
            닫기
          </button>
        </header>
        <form className="schedule-board-filter-form" onSubmit={handleSubmit}>
          <div className="schedule-board-filter-body">
            <p id={`${id}-description`} className="schedule-board-filter-description">
              같은 종류 안에서는 선택한 항목 중 하나에 해당하면 표시합니다. 일정 종류, 프로젝트 종류, 검색어를 함께 설정하면 모든 조건에 맞는 일정을 표시합니다.
            </p>
            <label className="schedule-board-filter-search" htmlFor={`${id}-search`}>
              검색어
              <input
                ref={searchRef}
                id={`${id}-search`}
                type="text"
                value={draft.keyword}
                placeholder="일정 제목, 내용, 프로젝트, 일정 종류 검색"
                onChange={(event) => setDraft((previous) => ({ ...previous, keyword: event.target.value }))}
              />
            </label>
            <FilterSelectionGroup
              title="일정 종류"
              items={orderedTaskTypes}
              selectedIds={draft.taskTypeIds}
              onChange={(taskTypeIds) => setDraft((previous) => ({ ...previous, taskTypeIds }))}
            />
            <FilterSelectionGroup
              title="프로젝트 종류"
              items={sortProjects(projects)}
              selectedIds={draft.projectIds}
              onChange={(projectIds) => setDraft((previous) => ({ ...previous, projectIds }))}
            />
          </div>
          <footer className="schedule-board-filter-footer">
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => setDraft({ taskTypeIds: [], projectIds: [], keyword: "" })}
            >
              초기화
            </button>
            <div className="schedule-board-filter-footer-actions">
              <button type="button" className="btn btn-soft" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                필터 적용
              </button>
            </div>
          </footer>
        </form>
      </section>
    </ModalBackdrop>
  );
}
