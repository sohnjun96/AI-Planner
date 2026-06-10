# AI Planner

AI Planner is a full-page Chrome extension for calendar-based work planning. It centers the dashboard, calendar, AI-assisted schedule creation, project tracking, archive browsing, and local-first data storage in one interface.

## Current product shape
- Full-page app: clicking the extension opens `index.html#/dashboard`
- Main tabs: `대시보드`, `프로젝트`, `보관함`, `설정`
- Dashboard calendar views: `목록`, `주간`, `월간`
- AI schedule modal: natural-language create, update, delete proposals with explicit apply confirmation
- Local storage: IndexedDB via Dexie
- Build output: `dist`

## Core features
- Dashboard-first planning with a large month calendar and per-day agenda
- Collapsible top summary for `오늘 일정` and `제출 일정`
- AI schedule modal with keyboard flow
- Right-click context menu on calendar days
- Right-click context menu on task cards
- Project management with status and type-based filtering
- Archive view for completed past schedules
- Global memo with checklist support
- Undo for the latest change
- Notification and backup settings

## AI workflow
1. Open `AI 일정 추가` from the top bar, shortcut, or calendar day context menu.
2. Enter a natural-language request.
3. Review the generated operations.
4. Apply the selected operations.

Supported AI actions:
- Create schedules
- Update schedules
- Delete schedules

Current UX details:
- `A` or `Ctrl+Shift+N` opens the AI modal
- `Esc` closes the AI modal
- When a proposal is ready, `Enter` applies the selected draft
- When the modal is opened with a prefilled request, the textarea is focused and the cursor moves to the end

## Context menus
Calendar day context menu:
- `AI 일정 추가`
- `일정 직접 추가`
- `해당 날짜 보기`

Task card context menu:
- `완료하기` or `보류하기`
- `수정`
- `AI로 수정`
- `복제`
- `삭제`

## Settings
The settings page stores values immediately, including:
- `LLM Endpoint`
- `LLM Model`
- `LLM API Key`
- Week start day
- Time format
- Notifications
- Automatic backups
- Task types

## Install
Load the built extension from `dist`.

1. Open `chrome://extensions`
2. Enable `개발자 모드`
3. Click `압축해제된 확장 프로그램을 로드합니다`
4. Select `dist`

## Development
Run commands inside `source`.

```bash
npm install
npm run build
```

For local development:

```bash
npm run dev
```

## Stack
- React
- TypeScript
- Vite
- Dexie
- Chrome Extension Manifest V3

## Notes
- General schedule management works offline
- AI features require access to a reachable LLM endpoint
