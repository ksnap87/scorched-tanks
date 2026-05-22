# 🔥 Scorched Earth — Tank Battle

최대 10인 멀티플레이어 탱크 대전 게임. URL 한 줄로 친구 초대.

## 🎮 플레이

URL에 룸 코드가 자동 부착됩니다 — 친구한테 그 URL만 보내면 같은 방에 입장됩니다.

- `?room=ABC12` 형태로 룸 분리
- `🔗 COPY LINK` 버튼으로 클립보드 복사
- `+ NEW ROOM` 버튼으로 새 방 생성

### 조작
- **←→** 각도 / **↑↓** 파워 / **SPACE** 발사
- **A / D** 한 칸 이동 (5px) / **X** 더블샷 토글
- **숫자 입력**: 각도/파워/이동 거리 직접 입력
- **ENTER**: 인게임 채팅 입력

## 🚀 로컬 실행

```bash
npm install
npm start
# → http://localhost:3000
```

## ☁️ Render 배포

1. 이 repo를 GitHub에 푸시 (이미 되어 있음)
2. [Render Dashboard](https://dashboard.render.com/) → **New → Web Service**
3. GitHub repo 연결 → 자동으로 `render.yaml` 인식
4. 5분 후 `https://scorched-tanks-xxxx.onrender.com` 발급

> Free 플랜: 15분 idle 시 sleep, 첫 접속 시 ~30초 콜드스타트.

## 🛠 Stack

- Node.js + Express
- Socket.IO (실시간 멀티플레이)
- HTML5 Canvas
