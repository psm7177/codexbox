# 개발자 가이드

## 구조 요약

- `src/index.ts`: bootstrap 및 wiring
- `src/chat/`: Discord 메시지 라우팅, Codex turn 실행
- `src/codex/`: Codex app-server용 JSON-RPC transport
- `src/commands/`: `!codex ...` 명령 핸들러
- `src/discord/`: Discord 전송 helper
- `src/startup/`: 어드민 startup 상태 로깅
- `src/state/`: conversation/workspace 도메인 서비스
- `scripts/lib/`: setup, MCP 등록, systemd helper

## 프로젝트 구조

영문 문서의 `Project Layout` 트리를 참고하면 됩니다.

## MCP 연동

- setup 시 로컬 MCP 서버 `codexbox-tools`를 등록합니다
- 이 서버는 `send_discord_image(channel_id, image, caption?)` tool을 제공합니다
- 봇은 매 turn마다 현재 Discord `channel_id`를 Codex 입력에 주입합니다
- MCP 서버는 저장소의 `.env`를 직접 읽기 때문에 `DISCORD_TOKEN`을 별도로 `codex mcp add --env ...` 로 넘길 필요가 없습니다
- 지원하는 이미지 입력:
  - 로컬 이미지 경로
  - `https://...` 이미지 URL
  - `data:image/...` URL
- 로컬 파일 접근 범위는 `CODEX_WORKSPACE`, `$HOME`, `/tmp`, `DISCORD_MCP_ALLOWED_ROOTS`로 제한됩니다

## 배포 및 안전 주의사항

- `.env`, `.data/`, `dist/`는 커밋하지 마세요
- 배포 전 `CODEX_WORKSPACE`가 민감한 절대경로가 아닌지 확인하세요
- `CODEX_APPROVAL_POLICY=never`는 의도적으로 바꾸는 경우가 아니면 유지하는 편이 안전합니다
- `CODEX_SANDBOX_MODE`는 보통 `workspaceWrite` 또는 `readOnly`를 유지하세요
- Discord Message Content Intent를 켰다면:

```bash
DISCORD_MESSAGE_CONTENT_INTENT=true
```

- restart 권한은 아래로 제한합니다:

```bash
DISCORD_RESTART_ADMIN_USER_IDS=123456789012345678,234567890123456789
```

- Codex binary 경로를 직접 지정해야 하면:

```bash
CODEX_APP_SERVER_BIN=/path/to/codex
CODEX_APP_SERVER_ARGS="app-server --listen stdio://"
```

## 유용한 개발 명령

```bash
npm run build
npm test
npm start
codex mcp get codexbox-tools
```
