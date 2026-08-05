# 망별 빌드 사용 방법

AI Endpoint와 Chrome 확장 프로그램의 접속 권한은 `config/build-profiles.json`에서 망별로 관리한다. API 키, 토큰, 비밀번호는 이 파일이나 소스 코드에 기록하지 않는다.

## 빌드 프로필

| 프로필 | 용도 | Chat Completions | Models | 출력 폴더 |
| --- | --- | --- | --- | --- |
| `internal` | 내부망 운영 | `https://llm.moip.go.kr/api/chat/completions` | `https://llm.moip.go.kr/v1/models` | `dist` |
| `external` | 외부망 테스트 | `https://api.openai.com/v1/chat/completions` | `https://api.openai.com/v1/models` | `dist-external` |

## 사용 명령

```powershell
# 내부망 운영본
npm run build:internal

# 외부망 테스트본
npm run build:external
```

`npm run build`는 내부망 운영본과 동일하다. 개발 화면은 내부망 `npm run dev`, 외부망 `npm run dev:external`로 실행한다.

Chrome의 `확장 프로그램 관리`에서 `압축해제된 확장 프로그램을 로드합니다`를 선택하고, 내부망은 `dist`, 외부망은 `dist-external` 폴더를 지정한다. 두 폴더를 별도의 확장 프로그램으로 로드하면 Chrome 저장소도 분리되므로 테스트용 API 키가 내부망 운영본에 섞이지 않는다.

## 안전장치

- 빌드 프로필은 HTTPS 주소만 허용하며 사용자 정보, 쿼리 문자열, 해시가 포함된 주소를 거부한다.
- Chat Completions와 Models 주소가 같은 출처인지, 예상 경로로 끝나는지 빌드 전에 확인한다.
- 생성된 매니페스트에는 선택한 출처의 `host_permissions`와 CSP만 포함하며, 번들에 반대편 망 주소가 들어가면 빌드를 실패시킨다.
- Endpoint를 변경할 때는 `config/build-profiles.json`만 수정하고 두 빌드를 다시 검증한다.
