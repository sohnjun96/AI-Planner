# Tool Calling 구현 가이드

PLANAI의 AI 기능은 OpenAI 호환 Chat Completions API를 사용하지만, API 요청의 `tools` / `tool_choice` 필드에 의존하지 않습니다. 대신 모델이 **정해진 JSON 응답 안의 `toolCalls` 배열**로 필요한 조회를 선언하고, 앱이 이를 검증·실행한 뒤 결과를 다음 모델 호출에 다시 넣는 제어형(애플리케이션 관리형) Tool Calling을 구현합니다.

이 방식은 로컬 우선 구조를 유지하면서 OpenAI 호환 엔드포인트와 로컬 모델을 폭넓게 지원하기 위한 선택입니다. 모든 도구는 브라우저 메모리에 로드된 일정·노트·프로젝트 데이터를 조회하며, 도구 호출 자체로 데이터를 변경하지 않습니다.

## 한눈에 보기

```mermaid
sequenceDiagram
    participant U as 사용자
    participant UI as AI 화면
    participant A as 에이전트
    participant L as LLM API
    participant T as 로컬 도구

    U->>UI: 자연어 요청
    UI->>A: 현재 데이터와 요청 전달
    A->>L: 시스템 지침 + JSON 페이로드 전송
    L-->>A: JSON 또는 toolCalls
    alt 조회가 필요한 경우
        A->>A: 허용 도구와 인자 검증
        A->>T: 로컬 데이터 조회
        T-->>A: 제한된 조회 결과
        A->>L: toolResults를 포함해 재요청
        L-->>A: 최종 JSON
    end
    A-->>UI: 답변 또는 일정 변경 초안
    opt 일정 변경 초안
        UI-->>U: 항목별 검토·선택
        U->>UI: 적용
        UI->>UI: 선택한 변경만 로컬 DB에 반영
    end
```

## 처리 흐름

1. 각 에이전트는 현재 시각, 사용자 요청, 필요한 빠른 목록(카탈로그), 이전 `toolResults`를 JSON 문자열로 만들어 LLM에 보냅니다.
2. 모델은 한 개의 JSON 객체만 반환합니다. 정보가 부족하면 최종 답변 대신 `toolCalls`를 반환합니다.
3. 앱은 에이전트별 허용 도구만 통과시키고, 같은 도구·인자의 중복 호출을 제거한 뒤 로컬에서 실행합니다.
4. 실행 결과를 `toolResults`에 누적하여 다시 모델에 전달합니다. 최대 3라운드 안에서 최종 결과를 만들도록 제한합니다.
5. 일정 에이전트의 `create_task`·`update_task`·`delete_task`는 도구가 아니라 **변경 초안(proposal)** 입니다. 모델이 직접 저장하지 않으며, 사용자가 화면에서 선택해 적용할 때만 반영됩니다.

### LLM 요청·응답 형식

LLM 클라이언트는 `model`, `messages`, `stream`, `temperature`를 포함한 OpenAI 호환 Chat Completions 요청을 보냅니다. 설정에 따라 `reasoning_effort`와 Gemma 4용 `chat_template_kwargs.enable_thinking`도 추가합니다. 스트리밍이 활성화된 경우 SSE의 텍스트 델타를 UI 진행 상태에 표시하며, 일반 JSON 응답도 지원합니다.

모델의 응답 본문은 JSON 객체여야 합니다. 마크다운 코드 펜스 또는 앞뒤 텍스트가 섞인 경우에도 객체 부분을 추출해 파싱을 시도합니다. 파싱에 실패하면 JSON만 반환하라는 안내를 붙여 한 번 재시도합니다.

기본적인 도구 호출 모습은 다음과 같습니다.

```json
{
  "answer": "",
  "toolCalls": [
    {
      "tool": "search_tasks",
      "args": { "keyword": "팀 회의", "date": "2026-07-20", "limit": 10 }
    }
  ]
}
```

도구 실행 결과는 다음 호출에서 아래와 같은 구조로 모델에 제공됩니다.

```json
{
  "tool": "search_tasks",
  "args": { "keyword": "팀 회의", "date": "2026-07-20", "limit": 10 },
  "ok": true,
  "result": [{ "id": "...", "title": "팀 회의", "startAt": "..." }]
}
```

## 에이전트별 도구 사용 범위

| 에이전트 / 화면 | 용도 | 사용할 수 있는 도구 |
| --- | --- | --- |
| 일정 AI (`scheduleAgent`) | 일정 생성·수정·삭제 초안 작성, 개인 규칙 제안 | `list_projects`, `list_task_types`, `search_tasks`, `get_task` |
| 데이터 질문 (`qaAgent`) | 노트와 일정에 관한 질의응답, 근거 링크 생성 | `search_notes`, `get_note`, `search_tasks`, `get_task` |
| 노트 AI (`notesAgent`) | 노트 검색 시 관련 노트·연결 일정 탐색 | `search_notes`, `get_note`, `list_note_versions`, `get_linked_tasks` |
| 브리핑·빠른 노트 제목 | 오늘의 브리핑, 제목 생성 | 도구 호출 없음 |

노트 AI의 도구는 `search` 모드에서만 활성화됩니다. 편집·요약·병합·선택 영역 편집은 현재 노트 본문을 직접 전달해 처리하므로 추가 조회를 하지 않습니다.

## 도구 상세

### 일정·프로젝트 도구

| 도구 | 사용 가능한 에이전트 | 인자 | 동작 및 반환값 |
| --- | --- | --- | --- |
| `list_projects` | 일정 AI | 없음 | 모든 프로젝트의 `id`, 이름, 설명, 활성 여부를 반환합니다. 프로젝트를 특정해야 하는 일정 초안에 사용합니다. |
| `list_task_types` | 일정 AI | 없음 | 모든 일정 종류의 `id`, 이름, 활성 여부를 반환합니다. |
| `search_tasks` | 일정 AI, 데이터 질문 | `keyword` 또는 `title`, `status`, `date`, `startDate`, `endDate`, `projectId`, `limit` (모두 선택) | 제목·내용·프로젝트·종류를 대상으로 검색합니다. 날짜 조건이 있으면 시작 시각 오름차순, 없으면 수정 시각 내림차순으로 정렬합니다. 일정 요약과 프로젝트·종류 이름을 반환합니다. |
| `get_task` | 일정 AI, 데이터 질문 | `taskId` (필수) | 하나의 일정 상세를 반환합니다. 내용은 검색 결과보다 길게 제공되며, 프로젝트 설명도 포함합니다. |

`search_tasks.status`는 `NOT_DONE`, `ON_HOLD`, `DONE`, `CANCELED` 또는 일반적인 영문·한국어 별칭을 받을 수 있습니다. 날짜는 `YYYY-MM-DD` 형식이며, 형식이 맞지 않는 필터는 경고와 함께 무시됩니다.

### 노트 도구

| 도구 | 사용 가능한 에이전트 | 인자 | 동작 및 반환값 |
| --- | --- | --- | --- |
| `search_notes` | 데이터 질문, 노트 AI 검색 | `keyword`, `projectId`, `tag`, `status`, `limit` (모두 선택) | 제목·본문·태그·프로젝트 이름을 검색하고, 최근 수정 순으로 노트 요약을 반환합니다. `status`는 `draft`, `active`, `archived`만 허용합니다. |
| `get_note` | 데이터 질문, 노트 AI 검색 | `noteId` (필수) | 노트의 제목·본문·프로젝트·태그·상태·연결 일정 ID를 반환합니다. 긴 본문은 잘렸는지 여부와 함께 제한됩니다. |
| `get_linked_tasks` | 노트 AI 검색 | `noteId` (필수) | 해당 노트에 연결된 일정의 ID, 제목, 시작 시각, 상태를 반환합니다. |
| `list_note_versions` | 노트 AI 검색 | 없음 | 현재 버전 이력은 노트 UI에서 관리하므로, 도구에서는 UI의 이력 패널을 안내하는 응답만 반환합니다. 실제 버전 목록을 읽는 도구는 아직 아닙니다. |

### 내부 전용 도구

`execCurrentDatetime`은 현재 ISO 시각을 반환하는 공용 실행 함수입니다. 현재 일정·질문·노트 에이전트에는 노출하지 않습니다. 각 프롬프트의 `now` 필드로 이미 현재 시각을 전달하기 때문에 모델이 시간 조회를 별도로 요청할 필요가 없습니다.

## 검증, 제한 및 안전장치

| 항목 | 구현 방식 |
| --- | --- |
| 도구 허용 목록 | 에이전트마다 허용 이름을 고정합니다. 알 수 없는 도구는 실행하지 않습니다. |
| 호출 수 | 한 모델 응답에서 최대 2개 호출만 허용하며, 전체 과정은 최대 3라운드로 제한합니다. |
| 중복 방지 | 도구명과 정렬된 인자를 키로 캐시합니다. 이미 실행한 동일 호출은 건너뛰고 기존 결과 사용을 안내합니다. |
| 인자 검증 | 검색 한도는 1~30으로 보정하고, 날짜·상태·필수 ID를 검사합니다. 잘못된 필터는 경고를 남기거나 무시합니다. |
| 결과 크기 | 검색 결과는 기본 15개·최대 30개로 제한합니다. 누적 결과는 최근 16개, 직렬화 기준 약 12,000자로 제한합니다. 긴 노트·일정 본문도 잘라 전송합니다. |
| 프롬프트 인젝션 방어 | 카탈로그, 노트 본문, 도구 결과는 신뢰할 수 없는 데이터이며 그 안의 명령을 따르지 말라고 시스템 지침에 명시합니다. |
| 변경 안전성 | 조회 도구는 모두 읽기 전용입니다. 일정 변경은 초안으로만 반환되고, 삭제 초안은 검토 UI에서 기본 선택되지 않습니다. 도구로 조회한 일정의 수정·삭제 초안에는 `updatedAt`을 `expectedUpdatedAt`으로 담아 오래된 제안의 적용을 막습니다. |
| 취소·오류 | `AbortSignal`로 요청 취소를 전달합니다. HTTP 오류, 비어 있는 응답, JSON 파싱 실패는 사용자에게 안전한 실패 메시지로 처리합니다. |

데이터 질문 에이전트는 모델 제공자별 표기 차이를 흡수하기 위해 `tool`, `name`, `tool_name`, `function.name`과 `args`, `arguments`, `parameters`, `input`, `function.arguments`를 해석합니다. 일정·노트 에이전트는 프롬프트에서 요구한 표준 `tool` / `args` 형식을 사용합니다.

## 구현 파일 안내

| 파일 | 역할 |
| --- | --- |
| [`src/agent/llmClient.ts`](../src/agent/llmClient.ts) | OpenAI 호환 요청, SSE 처리, 사용량 기록 |
| [`src/agent/agentUtils.ts`](../src/agent/agentUtils.ts) | JSON 복구·재시도, 유연한 호출 파싱, 호출 수 제한 |
| [`src/agent/agentTools.ts`](../src/agent/agentTools.ts) | 공용 읽기 전용 도구 실행기, 검색·결과 크기 제한·중복 캐시 |
| [`src/agent/scheduleAgent.ts`](../src/agent/scheduleAgent.ts) | 일정 AI의 도구 루프와 변경 초안 파싱 |
| [`src/agent/qaAgent.ts`](../src/agent/qaAgent.ts) | 데이터 질문의 도구 루프와 참고 자료 검증 |
| [`src/agent/notesAgent.ts`](../src/agent/notesAgent.ts) | 노트 검색 모드의 도구 루프 |
| [`src/components/AiAssistantWorkspace.tsx`](../src/components/AiAssistantWorkspace.tsx) | 일정 초안의 사용자 검토·선택·로컬 반영 |

## 개발 시 유의점

- 새 도구를 추가할 때는 실행 함수만 추가하지 말고, 해당 에이전트의 허용 목록·프롬프트 스키마·실행 분기·사용자 노출 문구를 함께 갱신합니다.
- 도구가 쓰기 작업을 수행해야 한다면 기존 일정 초안처럼 사용자 검토 단계를 분리하고, 모델 응답만으로 즉시 저장하지 않습니다.
- 모델이 결과와 `toolCalls`를 한 응답에 함께 보낼 수 있습니다. 데이터 질문 에이전트는 마지막 라운드에서 이미 작성된 답변을 보존할 수 있도록 처리하지만, 새 프롬프트는 조회 요청과 최종 답변을 분리하도록 유지하는 편이 안전합니다.
