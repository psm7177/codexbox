# Advanced Setup

## 이미 checkout 한 저장소에서 수동 설치

```bash
npm install
cp .env.example .env
npm run build
npm start
```

## setup 스크립트만 직접 실행

```bash
bash scripts/setup-linux.sh
```

## 기존 checkout에서 systemd 서비스 설치

```bash
INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## MCP 등록 건너뛰기

```bash
INSTALL_CODEX_DISCORD_MCP=0 bash scripts/setup-linux.sh
```

## 토큰 프롬프트 없이 실행

```bash
DISCORD_TOKEN=your_token_here bash scripts/setup-linux.sh
```

## Unpaywall로 DOI PDF 다운로드 활성화

`download_open_access_pdf`로 OA PDF를 내려받으려면 봇 시작 전에 이메일 주소를 설정하세요.

```bash
CODEX_OSS_BASE_URL=http://localhost:11434/v1 UNPAYWALL_EMAIL=you@example.com npm start
```

## systemd scope 강제

```bash
SYSTEMD_SERVICE_SCOPE=system INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## 서비스 이름 또는 사용자 지정

```bash
SYSTEMD_SERVICE_NAME=my-codex-bot SYSTEMD_SERVICE_USER=ubuntu INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## user service linger 비활성화

```bash
SYSTEMD_ENABLE_LINGER=0 SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## 서비스 확인 명령

```bash
sudo systemctl status codexbox --no-pager
sudo journalctl -u codexbox -f
systemctl --user status codexbox --no-pager
journalctl --user -u codexbox -f
```
