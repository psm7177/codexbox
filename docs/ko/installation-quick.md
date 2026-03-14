# Quick Setup

## 필수 조건

- Node.js 20 이상
- 전역 설치된 `codex` CLI와 `codex app-server`
- 해당 머신에서 동작하는 Codex 인증/설정
- Discord bot token

## 공개 GitHub 저장소 기준 Linux 원터치 설치

```bash
curl -fsSL https://raw.githubusercontent.com/psm7177/codexbox/master/scripts/install-public-linux.sh | bash
```

## 이 과정에서 하는 일

- `https://github.com/psm7177/codexbox.git` 를 clone 또는 update
- `scripts/setup-linux.sh` 실행
- dependency 설치
- `.env` 생성
- `DISCORD_TOKEN` 입력
- 첫 build 실행
- `codex-discord-tools` MCP 서버 등록
- `codex-discord` systemd 서비스 설치 및 시작
