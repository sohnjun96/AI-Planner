import { useMemo, useState } from "react";
import { ColorSelector } from "../components/ColorSelector";
import { pickRandomPresetColor } from "../constants";
import { useAppData } from "../context/AppDataContext";

interface TypeFormState {
  id?: string;
  name: string;
  color: string;
  isActive: boolean;
  isDefault: boolean;
}

function createEmptyTypeForm(): TypeFormState {
  return {
    id: undefined,
    name: "",
    color: pickRandomPresetColor(),
    isActive: true,
    isDefault: false,
  };
}

export function TypesPage() {
  const { taskTypes, upsertTaskType, deleteTaskType } = useAppData();
  const [form, setForm] = useState<TypeFormState>(() => createEmptyTypeForm());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sortedTypes = useMemo(() => [...taskTypes].sort((a, b) => a.order - b.order), [taskTypes]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await upsertTaskType({
        id: form.id,
        name: form.name,
        color: form.color,
        isActive: form.isActive,
      });
      setSuccess(form.id ? "종류가 수정되었습니다." : "종류가 생성되었습니다.");
      if (!form.id) {
        setForm(createEmptyTypeForm());
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "종류 저장에 실패했습니다.");
    }
  }

  async function handleDelete() {
    if (!form.id) {
      return;
    }
    setError("");
    setSuccess("");
    try {
      await deleteTaskType(form.id);
      setSuccess("종류가 삭제되었습니다.");
      setForm(createEmptyTypeForm());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "종류 삭제에 실패했습니다.");
    }
  }

  return (
    <div className="entity-layout">
      <section className="panel">
        <header className="panel-header">
          <h2>일정 종류</h2>
          <small>{sortedTypes.length}개</small>
        </header>
        <ul className="entity-list">
          {sortedTypes.map((type) => (
            <li
              key={type.id}
              className={`entity-item ${form.id === type.id ? "selected" : ""}`}
              onClick={() =>
                setForm({
                  id: type.id,
                  name: type.name,
                  color: type.color,
                  isActive: type.isActive,
                  isDefault: type.isDefault,
                })
              }
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setForm({
                    id: type.id,
                    name: type.name,
                    color: type.color,
                    isActive: type.isActive,
                    isDefault: type.isDefault,
                  });
                }
              }}
              >
                <span className="color-dot" style={{ backgroundColor: type.color }} />
                <strong>{type.name}</strong>
                <small>{type.isDefault ? "기본" : "사용자"}</small>
              </li>
            ))}
          </ul>
      </section>

      <section className="panel">
        <h2>{form.id ? "종류 수정" : "새 종류"}</h2>
        <form className="task-form" onSubmit={handleSubmit}>
          <label>
            종류명
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>

          <label>
            색상
            <ColorSelector value={form.color} onChange={(nextColor) => setForm((prev) => ({ ...prev, color: nextColor }))} />
          </label>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
            />
            사용
          </label>
          <div className="button-row">
            <button className="btn btn-primary" type="submit">
              {form.id ? "저장" : "생성"}
            </button>
            {form.id && !form.isDefault ? (
              <button className="btn btn-danger" type="button" onClick={() => void handleDelete()}>
                삭제
              </button>
            ) : null}
            <button className="btn btn-soft" type="button" onClick={() => setForm(createEmptyTypeForm())}>
              초기화
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {success ? <p className="success-text">{success}</p> : null}
        </form>
      </section>
    </div>
  );
}
