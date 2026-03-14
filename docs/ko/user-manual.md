# 사용자 매뉴얼

## 무엇을 하는 봇인가

- 각 길드 텍스트 채널은 자체 `cwd`를 가집니다
- 각 Discord 스레드는 자체 Codex 세션을 가지며 부모 채널의 `cwd`를 상속받습니다
- DM도 자체 `cwd`를 가지며 기본값은 `CODEX_WORKSPACE`입니다
- 같은 Discord 대화 안에서는 turn이 직렬화되어 Codex 세션 히스토리가 꼬이지 않습니다
- 길드 텍스트 채널에서는 봇 멘션 또는 답글일 때 반응합니다
- DM에서는 항상 반응합니다

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
