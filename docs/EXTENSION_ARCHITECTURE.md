# Work Schedule Manager Extension Architecture

## 1) Information Architecture
- `#/dashboard`: calendar, per-day task summary, major tasks, memo
- `#/tasks`: task CRUD, filter/search, status updates
- `#/projects`: project name/color/active management
- `#/types`: task type name/color/active management
- `#/archive`: completed + past tasks only (restore available)
- `#/settings`: week start, time format, backup/restore

## 2) Business Rules
- Default task types:
  - 작성, 제출, 보고, 행사, 출장, 연가, 기타
- Task status:
  - 미완료, 보류, 완료
- Required task fields:
  - title, date/time, type, project
- Auto metadata:
  - `createdAt`, `updatedAt`, `completedAt`
- Past-completed visibility:
  - hidden by default
  - shown only when `지난 완료 업무 보기` is enabled
- Color mapping:
  - project color: left border on task card
  - type color: badge tag
  - status color: fixed palette

## 3) Tech Stack
- React + TypeScript
- Routing: `HashRouter`
- Storage: IndexedDB (`Dexie`)
- Extension spec: Chrome MV3
- Launch mode: icon click opens `index.html#/dashboard`

## 4) Core Modules
- `src/models.ts`: domain models
- `src/db.ts`: Dexie schema + bootstrap seed
- `src/context/AppDataContext.tsx`: app-level data operations
- `src/components/MonthCalendar.tsx`: monthly calendar
- `src/components/TaskForm.tsx`: create/edit task form
- `src/components/TaskItem.tsx`: task card UI
- `src/components/AppShell.tsx`: sidebar + top toggle layout

## 5) Directory Structure
```text
public/
  manifest.json
  background.js
src/
  components/
    AppShell.tsx
    MonthCalendar.tsx
    TaskForm.tsx
    TaskItem.tsx
  context/
    AppDataContext.tsx
  pages/
    DashboardPage.tsx
    TasksPage.tsx
    ProjectsPage.tsx
    TypesPage.tsx
    ArchivePage.tsx
    SettingsPage.tsx
  utils/
    date.ts
  constants.ts
  db.ts
  models.ts
  App.tsx
  main.tsx
  index.css
scripts/
  build-extension.mjs
```

## 6) Future Extensions
- deadline alerts (`chrome.alarms`, `notifications`)
- recurring tasks (weekly/monthly)
- dashboard analytics (completion rate, project/type distribution)
- CSV export and sync support
