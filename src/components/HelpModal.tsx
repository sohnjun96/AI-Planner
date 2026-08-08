import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

interface HelpModalProps {
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; desc: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "일정",
    items: [
      { keys: "A", desc: "AI 일정 추가 열기" },
      { keys: "Ctrl + Shift + N", desc: "AI 일정 추가 열기" },
      { keys: "Enter", desc: "AI 입력창에서 초안 만들기 / 선택 항목 반영" },
    ],
  },
  {
    title: "노트",
    items: [
      { keys: "더블클릭", desc: "노트 본문을 편집 모드로 전환" },
      { keys: "우클릭 (본문)", desc: "AI 편집 메뉴 (다듬기·요약·구조화 등)" },
      { keys: "우클릭 / ⋯ (카드)", desc: "열기·AI 요약·고정·상태 변경·삭제" },
      { keys: "Ctrl + S", desc: "노트 저장" },
      { keys: "Ctrl + Enter", desc: "빠른 입력 모달에서 노트 저장" },
    ],
  },
  {
    title: "공통",
    items: [
      { keys: "Ctrl + Z", desc: "마지막 일정 변경 실행 취소" },
      { keys: "?", desc: "이 도움말 열기" },
      { keys: "Esc", desc: "모달·메뉴 닫기" },
    ],
  },
];

export function HelpModal({ onClose }: HelpModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose });

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="modal-card help-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="단축키와 사용법"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="eyebrow">HELP</p>
            <h2>단축키 · 사용법</h2>
            <small>마우스 우클릭과 더블클릭에 유용한 기능이 숨어 있습니다.</small>
          </div>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        </header>

        <div className="help-groups">
          {GROUPS.map((group) => (
            <div key={group.title} className="help-group">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.keys + item.desc}>
                    <kbd>{item.keys}</kbd>
                    <span>{item.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </ModalBackdrop>
  );
}
