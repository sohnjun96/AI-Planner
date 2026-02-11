# AI-Planner

OpenWebUI API based planner as a full-page Chrome extension for work schedule management.

## Features
- Dashboard calendar view with day tasks and major tasks
- Task, project, and task type management
- Archive for completed past tasks
- Settings for time/week preferences and backup import/export
- AI assistant workflow:
  - natural language request
  - agentic planning with task/project lookup tools
  - final proposal confirmation before apply

## Build
```bash
npm install
npm run lint
npm run build
```

## Load Extension
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `dist`
