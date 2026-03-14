# 사용자 매뉴얼

## 무엇을 하는 봇인가

`codexbox`는 Discord와 Codex를 연결하는 브리지입니다. 로컬 터미널 대신 Discord 대화 안에서 Codex를 사용할 수 있게 만드는 것이 이 프로젝트의 목적입니다.

이 프로젝트는 다음과 같은 목적에 맞습니다.

- 익숙한 채팅 인터페이스에서 Codex를 쓰고 싶은 경우
- 채널, 스레드, DM 단위로 작업 맥락을 유지하고 싶은 경우
- Discord를 벗어나지 않고 코딩, 파일 확인, 명령 실행, 이미지 관련 작업까지 처리하고 싶은 경우
- Codex가 설치된 로컬 머신에 연결된 self-hosted 봇을 운영하고 싶은 경우

요약하면, 이 프로젝트는 기존 Codex 실행 환경을 Discord에서 다룰 수 있게 해 주는 실용적인 프론트엔드입니다.

## 명령어

- `!codex help`
- `!codex status`
- `!codex cwd`
- `!codex cwd <path>`
- `!codex cwd reset`
- `!codex access`
- `!codex access workspace-write|read-only|full-access|reset`
- `!codex network`
- `!codex network on|off|reset`
- `!codex reset`
- `!codex restart`

## Discord 이미지 전송

- Codex가 만든 이미지 결과는 `imageView`, `imageGeneration` 같은 구조화된 app-server item을 통해 Discord로 다시 보낼 수 있습니다
- 사용자가 "Discord에 실제로 올려 달라"고 명시하면 Codex는 MCP tool `send_discord_image`를 호출할 수 있습니다
- 긴 caption은 Discord 2000자 제한에 맞게 자동으로 잘립니다
