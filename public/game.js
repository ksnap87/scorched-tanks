// ==========================================
//  SCORCHED EARTH - Client Game Engine
// ==========================================

// === Auth handling ===
const AUTH_TOKEN_KEY = 'st_token';
const AUTH_USER_KEY = 'st_user';
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || null;
let authUser = null;
try { authUser = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null'); } catch (e) { authUser = null; }

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
async function apiGet(path, withAuth) {
  const headers = withAuth && authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const r = await fetch(path, { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function saveAuth(token, user) {
  authToken = token;
  authUser = user;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  updateAuthBar();
}
function clearAuth() {
  authToken = null;
  authUser = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  updateAuthBar();
}

let authMode = 'login';
function openAuthModal(mode) {
  authMode = mode || 'login';
  const modal = document.getElementById('authModal');
  const title = document.getElementById('authModalTitle');
  const submit = document.getElementById('authSubmit');
  const switchText = document.getElementById('authSwitchText');
  const switchLink = document.getElementById('authSwitchLink');
  if (authMode === 'register') {
    title.textContent = '회원가입';
    submit.textContent = '가입하기';
    switchText.textContent = '이미 계정이 있나요?';
    switchLink.textContent = '로그인';
  } else {
    title.textContent = '로그인';
    submit.textContent = '로그인';
    switchText.textContent = '계정이 없으신가요?';
    switchLink.textContent = '회원가입';
  }
  document.getElementById('authError').textContent = '';
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('authUsername').focus(), 50);
}
function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
}
function switchAuthMode() {
  openAuthModal(authMode === 'login' ? 'register' : 'login');
}

async function submitAuth() {
  const u = document.getElementById('authUsername').value.trim();
  const p = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  if (!u || !p) { errEl.textContent = '아이디/비밀번호 입력'; return; }
  try {
    const data = await apiPost(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, { username: u, password: p });
    saveAuth(data.token, data.user);
    closeAuthModal();
    showToast(`✅ ${authMode === 'register' ? '가입 완료 — 새로고침 중' : '로그인됨 — 새로고침 중'}`);
    setTimeout(() => window.location.reload(), 600);
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function logout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  clearAuth();
  showToast('로그아웃됨 — 새로고침');
  setTimeout(() => window.location.reload(), 400);
}

function updateAuthBar() {
  const guest = document.getElementById('authGuest');
  const user = document.getElementById('authUser');
  const nameEl = document.getElementById('authUserName');
  const statsEl = document.getElementById('authUserStats');
  if (!guest || !user) return;
  if (authToken && authUser) {
    guest.style.display = 'none';
    user.style.display = 'flex';
    nameEl.textContent = `👤 ${authUser.username}`;
    const total = authUser.total_games || 0;
    const wins = authUser.wins || 0;
    const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
    statsEl.textContent = `${total}전 ${wins}승 ${authUser.losses || 0}패 (승률 ${rate}%)`;
  } else {
    guest.style.display = 'flex';
    user.style.display = 'none';
  }
}

async function openMyStats() {
  if (!authUser) return;
  const modal = document.getElementById('statsModal');
  document.getElementById('statsModalTitle').textContent = `${authUser.username} 님 전적`;
  document.getElementById('statsModalBody').innerHTML = '<div class="stats-loading">불러오는 중...</div>';
  modal.style.display = 'flex';
  try {
    const data = await apiGet(`/api/stats/${encodeURIComponent(authUser.username)}`);
    renderStatsModal(data);
  } catch (e) {
    document.getElementById('statsModalBody').innerHTML = `<div class="stats-error">조회 실패: ${e.message}</div>`;
  }
}

function renderStatsModal(data) {
  const u = data.user || {};
  const total = u.total_games || 0;
  const wins = u.wins || 0;
  const rate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const recent = data.recent || [];
  let recentHtml = '<div class="stats-empty">최근 경기 기록 없음</div>';
  if (recent.length > 0) {
    recentHtml = `<table class="stats-table">
      <thead><tr><th>결과</th><th>탱크</th><th>킬</th><th>데미지</th><th>점수</th><th>일시</th></tr></thead>
      <tbody>${recent.map(m => `<tr class="${m.won ? 'win' : 'loss'}">
        <td>${m.won ? '🏆 WIN' : 'LOSS'}</td>
        <td>${m.tank_type || '-'}</td>
        <td>${m.kills || 0}</td>
        <td>${m.damage_dealt || 0}</td>
        <td>${m.score || 0}</td>
        <td>${formatRelativeTime(m.played_at)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  document.getElementById('statsModalBody').innerHTML = `
    <div class="stats-summary">
      <div class="ss-card"><div class="ss-num">${total}</div><div class="ss-label">총 전적</div></div>
      <div class="ss-card win"><div class="ss-num">${wins}</div><div class="ss-label">승</div></div>
      <div class="ss-card loss"><div class="ss-num">${u.losses || 0}</div><div class="ss-label">패</div></div>
      <div class="ss-card"><div class="ss-num">${rate}%</div><div class="ss-label">승률</div></div>
      <div class="ss-card"><div class="ss-num">${u.total_kills || 0}</div><div class="ss-label">총 킬</div></div>
      <div class="ss-card"><div class="ss-num">${u.total_damage || 0}</div><div class="ss-label">총 데미지</div></div>
    </div>
    <h3 class="stats-h3">최근 경기 (최대 20)</h3>
    ${recentHtml}
  `;
}

async function openLeaderboard() {
  const modal = document.getElementById('statsModal');
  document.getElementById('statsModalTitle').textContent = '🏆 RANKING (TOP 20)';
  document.getElementById('statsModalBody').innerHTML = '<div class="stats-loading">불러오는 중...</div>';
  modal.style.display = 'flex';
  try {
    const data = await apiGet('/api/leaderboard');
    const entries = data.entries || [];
    if (entries.length === 0) {
      document.getElementById('statsModalBody').innerHTML = '<div class="stats-empty">아직 기록된 전적이 없습니다</div>';
      return;
    }
    const rows = entries.map((e, i) => {
      const total = e.total_games || 0;
      const wins = e.wins || 0;
      const rate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      return `<tr><td>${medal}</td><td>${e.username}</td><td>${wins}</td><td>${e.losses || 0}</td><td>${rate}%</td><td>${e.total_kills || 0}</td><td>${e.total_damage || 0}</td></tr>`;
    }).join('');
    document.getElementById('statsModalBody').innerHTML = `
      <table class="stats-table">
        <thead><tr><th>순위</th><th>아이디</th><th>승</th><th>패</th><th>승률</th><th>킬</th><th>데미지</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('statsModalBody').innerHTML = `<div class="stats-error">조회 실패: ${e.message}</div>`;
  }
}
function closeStatsModal() {
  document.getElementById('statsModal').style.display = 'none';
}

function formatRelativeTime(iso) {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toISOString().slice(0, 10);
}

// 모달 입력에서 Enter로 제출
document.addEventListener('DOMContentLoaded', () => {
  const u = document.getElementById('authUsername');
  const p = document.getElementById('authPassword');
  [u, p].forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) submitAuth();
    });
  });
});

// 초기 로그인 상태 갱신
updateAuthBar();

// === Room handling: URL ?room=XXXX ===
const urlParams = new URLSearchParams(window.location.search);
let roomId = (urlParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

function makeClientRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// 룸 코드 없으면 클라에서 즉시 생성 → URL 반영 (서버가 같은 코드로 룸 생성)
if (!roomId) {
  roomId = makeClientRoomCode();
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
}

const socket = io({
  query: { room: roomId },
  auth: { token: authToken || '' },
});

// DOM refs
const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('gameContainer');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerSlots = document.getElementById('playerSlots');
const btnStart = document.getElementById('btnStart');
const nameInput = document.getElementById('nameInput');
const angleSlider = document.getElementById('angleSlider');
const powerSlider = document.getElementById('powerSlider');
const angleInput = document.getElementById('angleInput');
const powerInput = document.getElementById('powerInput');
const angleValue = document.getElementById('angleValue'); // 없을 수도 있음 → null OK (모든 호출에 null-check)
const powerValue = document.getElementById('powerValue'); // 동일
const moveDistInput = document.getElementById('moveDistInput');
const weaponButtons = document.querySelectorAll('.btn-weapon');
const laserCountInBtn = document.getElementById('laserCountInBtn');
const btnFire = document.getElementById('btnFire');
const btnMoveLeft = document.getElementById('btnMoveLeft');
const btnMoveRight = document.getElementById('btnMoveRight');
const moveBudgetValue = document.getElementById('moveBudgetValue');
const btnDoubleShot = document.getElementById('btnDoubleShot');
const doubleShotCount = document.getElementById('doubleShotCount');
const hudRound = document.getElementById('hudRound');
const hudRoom = document.getElementById('hudRoom');
const turnName = document.getElementById('turnName');
const turnDot = document.getElementById('turnDot');
const windArrow = document.getElementById('windArrow');
const windValue = document.getElementById('windValue');
const timerCircle = document.getElementById('timerCircle');
const scoreboardEl = document.getElementById('scoreboard');
const scoreTitle = document.getElementById('scoreTitle');
const scoreList = document.getElementById('scoreList');
const toast = document.getElementById('toast');

const roomCodeEl = document.getElementById('roomCode');
const lobbyChatMessages = document.getElementById('lobbyChatMessages');
const lobbyChatInput = document.getElementById('lobbyChatInput');
const gameChat = document.getElementById('gameChat');
const gameChatBody = document.getElementById('gameChatBody');
const gameChatMessages = document.getElementById('gameChatMessages');
const gameChatInput = document.getElementById('gameChatInput');
const gcToggleIcon = document.getElementById('gcToggleIcon');

let myId = null;
let state = null;
let projectile = null;
let particles = [];
let trailParticles = [];
let stars = [];
let clouds = [];
let animFrame = null;

// UI state
let doubleShotMode = false;
let currentWeapon = 'normal';
let gameChatOpen = true;
let chatMessageIds = new Set();
let tankTypes = null;
let selectedTank = 'K2';

// === Init room code display ===
updateRoomCodeDisplay();

function updateRoomCodeDisplay() {
  if (roomCodeEl) roomCodeEl.textContent = roomId || '—';
  if (hudRoom) hudRoom.textContent = roomId || '—';
}

function copyRoomLink() {
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  const link = url.toString();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      showToast('🔗 링크 복사됨: ' + roomId);
    }).catch(() => fallbackCopy(link));
  } else {
    fallbackCopy(link);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('🔗 링크 복사됨');
  } catch (e) {
    showToast('링크: ' + text);
  }
  document.body.removeChild(ta);
}

function createNewRoom() {
  const newCode = makeClientRoomCode();
  const url = new URL(window.location);
  url.searchParams.set('room', newCode);
  window.location.href = url.toString();
}

// Generate starfield
for (let i = 0; i < 120; i++) {
  stars.push({
    x: Math.random() * 1400,
    y: Math.random() * 700,
    size: Math.random() * 1.5 + 0.3,
    alpha: Math.random() * 0.6 + 0.2,
    twinkleSpeed: Math.random() * 0.02 + 0.005,
    twinkleOffset: Math.random() * Math.PI * 2,
  });
}

// Generate clouds
for (let i = 0; i < 14; i++) {
  const layer = Math.random() < 0.5 ? 0 : 1;
  clouds.push({
    x: Math.random() * 1400,
    y: 40 + Math.random() * 220,
    scale: layer === 0 ? 0.6 + Math.random() * 0.3 : 0.9 + Math.random() * 0.5,
    alpha: layer === 0 ? 0.18 + Math.random() * 0.12 : 0.28 + Math.random() * 0.15,
    speed: layer === 0 ? 0.45 : 1.0,
    puffs: Math.floor(3 + Math.random() * 4),
    seed: Math.random() * 1000,
  });
}

// ==========================================
//  Socket handlers
// ==========================================

socket.on('init', (data) => {
  myId = data.playerId;
  if (data.tankTypes) {
    tankTypes = data.tankTypes;
    renderTankGrid();
  }
  if (data.roomId) {
    roomId = data.roomId;
    const url = new URL(window.location);
    if (url.searchParams.get('room') !== roomId) {
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
    }
    updateRoomCodeDisplay();
  }
});

function renderTankGrid() {
  const grid = document.getElementById('tankGrid');
  if (!grid || !tankTypes) return;
  // 능력치 점수 기반 바 표시 — 같은 점수면 같은 길이
  // 점수 환산: HP/4, range×25, move/8, speed×25  (합계 = 100)
  // 각 stat의 점수가 50점이면 바 100%
  const SCORE_DIVISOR = 50;
  const scoreOf = {
    hp: (v) => v / 4,
    range: (v) => v * 25,
    move: (v) => v / 8,
    speed: (v) => v * 25,
  };
  const pct = (score) => Math.min(100, Math.max(0, Math.round((score / SCORE_DIVISOR) * 100)));

  let html = '';
  Object.values(tankTypes).forEach(t => {
    const isSel = (selectedTank === t.id);
    const hpPct = pct(scoreOf.hp(t.hp));
    const rangePct = pct(scoreOf.range(t.range));
    const movePct = pct(scoreOf.move(t.move));
    const speedPct = pct(scoreOf.speed(t.speed));
    html += `<div class="tank-card${isSel ? ' selected' : ''}" data-tank="${t.id}" onclick="selectTank('${t.id}')">
      <div class="tc-head">
        <span class="tc-flag">${t.flag}</span>
        <span class="tc-name">${t.name}</span>
      </div>
      <div class="tc-country">${t.country} · ${t.desc}</div>
      <div class="tc-stats">
        <div class="ts-row"><span class="ts-label">HP</span><span class="ts-bar"><span class="ts-fill hp" style="width:${hpPct}%"></span></span><span class="ts-val">${t.hp}</span></div>
        <div class="ts-row"><span class="ts-label">사거리</span><span class="ts-bar"><span class="ts-fill range" style="width:${rangePct}%"></span></span><span class="ts-val">${t.range}×</span></div>
        <div class="ts-row"><span class="ts-label">이동</span><span class="ts-bar"><span class="ts-fill move" style="width:${movePct}%"></span></span><span class="ts-val">${t.move}</span></div>
        <div class="ts-row"><span class="ts-label">속도</span><span class="ts-bar"><span class="ts-fill speed" style="width:${speedPct}%"></span></span><span class="ts-val">${t.speed}×</span></div>
      </div>
    </div>`;
  });
  grid.innerHTML = html;
}

function selectTank(id) {
  if (!tankTypes || !tankTypes[id]) return;
  if (state && state.phase !== 'lobby') {
    showToast('⚠️ 게임 중에는 탱크 변경 불가');
    return;
  }
  selectedTank = id;
  socket.emit('setTank', id);
  renderTankGrid();
}

socket.on('serverFull', () => {
  showToast('⚠️ 방이 꽉 찼습니다');
});

socket.on('gameInProgress', () => {
  showToast('⚠️ 이미 진행 중인 게임 — 잠시 후 다시 시도');
});

socket.on('gameState', (data) => {
  const prevPhase = state ? state.phase : null;
  state = data;

  if (state.roomId && state.roomId !== roomId) {
    roomId = state.roomId;
    updateRoomCodeDisplay();
  }

  // 본인 탱크 선택 동기화
  if (state.players && myId && state.players[myId] && state.players[myId].tankType) {
    if (selectedTank !== state.players[myId].tankType) {
      selectedTank = state.players[myId].tankType;
      renderTankGrid();
    }
  }

  if (state.phase === 'lobby') {
    lobby.style.display = 'flex';
    gameContainer.style.display = 'none';
    scoreboardEl.style.display = 'none';
    if (gameoverCountdownTimer) {
      clearInterval(gameoverCountdownTimer);
      gameoverCountdownTimer = null;
    }
    gameoverEndsAt = null;
    updateLobby();
  } else if (state.phase === 'playing') {
    lobby.style.display = 'none';
    gameContainer.style.display = 'flex';
    scoreboardEl.style.display = 'none';
    updateHUD();
    updateControls();

    if (prevPhase === 'lobby' || prevPhase === null) {
      showToast('⚔️ BATTLE START');
    }
  } else if (state.phase === 'gameover') {
    scoreboardEl.style.display = 'flex';
    showScoreboard();
  }

  if (state.explosions) {
    state.explosions.forEach(exp => {
      if (Date.now() - exp.time < 500) {
        spawnExplosion(exp.x, exp.y, exp.radius);
      }
    });
  }
});

socket.on('projectileUpdate', (proj) => {
  projectile = proj;
  trailParticles.push({
    x: proj.x,
    y: proj.y,
    alpha: 1,
    size: 3,
    life: 30,
  });
});

socket.on('timerUpdate', (time) => {
  if (state) state.turnTimeLeft = time;
  timerCircle.textContent = time;
  timerCircle.classList.toggle('urgent', time <= 5);
});

let gameoverEndsAt = null;
let gameoverCountdownTimer = null;

socket.on('gameoverInfo', (data) => {
  if (!data || !data.endsAt) return;
  gameoverEndsAt = data.endsAt;
  startGameoverCountdown();
});

function startGameoverCountdown() {
  if (gameoverCountdownTimer) clearInterval(gameoverCountdownTimer);
  const el = document.getElementById('lobbyCountdown');
  if (!el) return;
  const tick = () => {
    if (!gameoverEndsAt) return;
    const remain = Math.max(0, Math.ceil((gameoverEndsAt - Date.now()) / 1000));
    el.textContent = remain;
    if (remain <= 0) {
      clearInterval(gameoverCountdownTimer);
      gameoverCountdownTimer = null;
    }
  };
  tick();
  gameoverCountdownTimer = setInterval(tick, 250);
}

socket.on('itemPickup', (data) => {
  if (!data) return;
  if (data.playerId === myId) {
    if (data.type === 'laser') {
      showToast('🚀 LASER STRIKE 획득!');
      currentWeapon = 'laser_guided';
      doubleShotMode = false;
      spawnPickupBurst();
    }
  } else {
    showToast(`📦 ${data.playerName || '누군가'} 박스 획득`);
  }
});

// === Chat handlers ===
socket.on('chatHistory', (msgs) => {
  chatMessageIds.clear();
  if (lobbyChatMessages) lobbyChatMessages.innerHTML = '';
  if (gameChatMessages) gameChatMessages.innerHTML = '';
  msgs.forEach(m => appendChatMessage(m, /*silent*/ true));
});

socket.on('chatMessage', (msg) => {
  appendChatMessage(msg, false);
});

function appendChatMessage(msg, silent) {
  if (!msg || !msg.id) return;
  if (chatMessageIds.has(msg.id)) return;
  chatMessageIds.add(msg.id);
  // 메모리: id set은 너무 커지면 정리
  if (chatMessageIds.size > 500) {
    chatMessageIds = new Set(Array.from(chatMessageIds).slice(-200));
  }

  [lobbyChatMessages, gameChatMessages].forEach(container => {
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (msg.type === 'system' ? 'sys' : 'user');
    if (msg.type === 'system') {
      div.textContent = msg.text;
    } else {
      const name = document.createElement('span');
      name.className = 'cm-name';
      name.style.color = msg.color || '#fff';
      name.textContent = msg.from || 'anon';
      const text = document.createElement('span');
      text.className = 'cm-text';
      text.textContent = ': ' + (msg.text || '');
      div.appendChild(name);
      div.appendChild(text);
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    while (container.children.length > 120) {
      container.removeChild(container.firstChild);
    }
  });

  // 인게임 채팅이 닫혀있고 본인 발신이 아니면 새 메시지 표시
  if (!silent && !gameChatOpen && state && state.phase === 'playing' && msg.type !== 'system') {
    if (gameChat) gameChat.classList.add('has-new');
  }
}

function spawnPickupBurst() {
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 80,
      y: 80,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      size: Math.random() * 3 + 2,
      color: '#FFD93D',
      life: 50,
      maxLife: 50,
    });
  }
}

// ==========================================
//  Lobby
// ==========================================

function updateLobby() {
  if (!state) return;
  const players = Object.values(state.players);

  let html = '';
  for (let i = 0; i < 10; i++) {
    if (i < players.length) {
      const p = players[i];
      const isMe = p.id === myId;
      const isHost = p.id === state.host;
      const tankDef = (tankTypes && p.tankType && tankTypes[p.tankType]) || null;
      const flag = tankDef ? tankDef.flag : '⬟';
      const tankShort = tankDef ? tankDef.id : '';
      html += `<div class="player-slot filled" style="border-color: ${p.color}40;">
        <div class="slot-icon" style="color: ${p.color};">${flag}</div>
        <div class="slot-name" style="color: ${p.color};">
          ${isHost ? '👑 ' : ''}${p.name}${isMe ? ' (YOU)' : ''}
        </div>
        <div class="slot-tank">${tankShort}</div>
      </div>`;
    } else {
      html += `<div class="player-slot">
        <div class="slot-icon">·</div>
        <div class="slot-name">EMPTY</div>
      </div>`;
    }
  }
  playerSlots.innerHTML = html;

  const isMyHost = state.host === myId;
  btnStart.disabled = players.length < 1 || !isMyHost;

  if (!isMyHost) {
    btnStart.textContent = `WAITING FOR HOST...`;
  } else {
    btnStart.textContent = players.length < 2
      ? `PRACTICE MODE (1 PLAYER)`
      : `START BATTLE (${players.length} PLAYERS)`;
  }
}

function setName() {
  const name = nameInput.value.trim();
  if (name) {
    socket.emit('setName', name);
    nameInput.value = '';
    showToast(`NAME SET: ${name.toUpperCase()}`);
  }
}

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) setName();
});

function startGame() {
  socket.emit('startGame');
}

// ==========================================
//  Chat — send
// ==========================================

function sendChatFromLobby() {
  if (!lobbyChatInput) return;
  const t = lobbyChatInput.value.trim();
  if (!t) return;
  socket.emit('chatMessage', t);
  lobbyChatInput.value = '';
}

function sendChatFromGame() {
  if (!gameChatInput) return;
  const t = gameChatInput.value.trim();
  if (!t) return;
  socket.emit('chatMessage', t);
  gameChatInput.value = '';
}

if (lobbyChatInput) {
  lobbyChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      sendChatFromLobby();
    }
    e.stopPropagation();
  });
}

if (gameChatInput) {
  // 게임 키보드 핸들러로 새지 않도록 stopPropagation
  gameChatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      sendChatFromGame();
      e.target.blur();
    }
    if (e.key === 'Escape') {
      e.target.blur();
    }
  });
  gameChatInput.addEventListener('keyup', (e) => e.stopPropagation());
  gameChatInput.addEventListener('keypress', (e) => e.stopPropagation());
}

function toggleGameChat() {
  gameChatOpen = !gameChatOpen;
  if (gameChat) gameChat.classList.toggle('collapsed', !gameChatOpen);
  if (gcToggleIcon) gcToggleIcon.textContent = gameChatOpen ? '▼' : '▲';
  if (gameChatOpen && gameChat) {
    gameChat.classList.remove('has-new');
    if (gameChatMessages) gameChatMessages.scrollTop = gameChatMessages.scrollHeight;
  }
}

// ==========================================
//  HUD & Controls
// ==========================================

function updateHUD() {
  if (!state) return;

  if (hudRound) hudRound.textContent = `${state.round} / ${state.maxRounds}`;
  if (hudRoom) hudRoom.textContent = roomId;

  const currentPlayer = state.players[state.currentTurn];
  if (currentPlayer) {
    turnName.textContent = currentPlayer.name;
    turnName.style.color = currentPlayer.color;
    turnDot.style.color = currentPlayer.color;
    turnDot.style.background = currentPlayer.color;
  }

  const w = state.wind;
  windArrow.textContent = w >= 0 ? '→' : '←';
  windArrow.style.transform = 'none';
  windValue.textContent = Math.abs(w).toFixed(3);

  timerCircle.textContent = state.turnTimeLeft;
  timerCircle.classList.toggle('urgent', state.turnTimeLeft <= 5);
}

function updateControls() {
  if (!state) return;
  const isMyTurn = state.currentTurn === myId;
  const me = state.players[myId];

  angleSlider.disabled = !isMyTurn;
  powerSlider.disabled = !isMyTurn;
  if (angleInput) angleInput.disabled = !isMyTurn;
  if (powerInput) powerInput.disabled = !isMyTurn;
  if (moveDistInput) moveDistInput.disabled = !isMyTurn;
  btnFire.disabled = !isMyTurn || !!projectile;

  if (me) {
    if (!isMyTurn) {
      const uiAngle = serverToUiAngle(me.angle);
      angleSlider.value = uiAngle;
      powerSlider.value = me.power;
      if (angleInput) angleInput.value = uiAngle;
      if (powerInput) powerInput.value = me.power;
      if (angleValue) angleValue.textContent = formatUiAngle(uiAngle);
      if (powerValue) powerValue.textContent = me.power;
    }

    const budget = me.moveBudget != null ? Math.round(me.moveBudget) : 0;
    if (moveBudgetValue) moveBudgetValue.textContent = budget;
    const canMove = isMyTurn && !projectile && budget > 0;
    if (btnMoveLeft) btnMoveLeft.disabled = !canMove;
    if (btnMoveRight) btnMoveRight.disabled = !canMove;

    const remaining = me.doubleShots ?? 0;
    const pending = !!me.doubleShotPending;
    if (btnDoubleShot) {
      const canToggle = isMyTurn && !projectile && remaining > 0 && !pending;
      btnDoubleShot.disabled = !canToggle;
      btnDoubleShot.classList.toggle('active', doubleShotMode && !pending);
      btnDoubleShot.classList.toggle('pending', pending);
      if (pending) {
        btnDoubleShot.innerHTML = '⚡ AUTO 2nd...';
      } else {
        btnDoubleShot.innerHTML = `⚡ DOUBLE × ${remaining}`;
      }
    }

    if (btnFire) {
      if (pending) btnFire.innerHTML = '🔥 ...';
      else if (doubleShotMode) btnFire.innerHTML = '🔥 FIRE × 2';
      else btnFire.innerHTML = '🔥 FIRE';
    }

    const laserCount = me.laserShots ?? 0;
    if (laserCountInBtn) laserCountInBtn.textContent = laserCount;
    if (currentWeapon === 'laser_guided' && laserCount <= 0) currentWeapon = 'normal';
    weaponButtons.forEach(btn => {
      const w = btn.dataset.weapon;
      btn.classList.toggle('active', w === currentWeapon);
      btn.classList.toggle('has-stock', w === 'laser_guided' && laserCount > 0);
      btn.disabled = !isMyTurn || !!projectile || (w === 'laser_guided' && laserCount <= 0);
    });
  }

  btnFire.style.opacity = isMyTurn ? '1' : '0.3';
}

// 키보드/한 스텝 이동 (5px)
function moveTankOnce(direction) {
  if (!state || state.currentTurn !== myId) return;
  const me = state.players[myId];
  if (!me) return;
  if ((me.moveBudget ?? 0) <= 0) {
    showToast('⚠️ 이동량 다 씀');
    return;
  }
  const optimistic = Math.max(0, (me.moveBudget ?? 0) - 5);
  if (moveBudgetValue) moveBudgetValue.textContent = optimistic;
  socket.emit('move', direction);
}

// 숫자 입력으로 N px 이동
function moveTankByDistance(direction) {
  if (!state || state.currentTurn !== myId) return;
  const me = state.players[myId];
  if (!me) return;
  if ((me.moveBudget ?? 0) <= 0) {
    showToast('⚠️ 이동량 다 씀');
    return;
  }
  let dist = parseInt(moveDistInput && moveDistInput.value);
  if (!Number.isFinite(dist) || dist <= 0) dist = 7;
  dist = Math.max(1, Math.min(200, dist));
  const actual = Math.min(dist, me.moveBudget ?? 0);
  const optimistic = Math.max(0, (me.moveBudget ?? 0) - actual);
  if (moveBudgetValue) moveBudgetValue.textContent = optimistic;
  socket.emit('moveBy', { direction, distance: dist });
}

function toggleDoubleShot() {
  if (!state) return;
  const me = state.players[myId];
  if (!me || state.currentTurn !== myId) return;
  if (me.doubleShotPending) return;
  if ((me.doubleShots ?? 0) <= 0) {
    showToast('⚠️ 더블샷 보유 없음');
    return;
  }
  if (currentWeapon === 'laser_guided') {
    showToast('⚠️ 레이저는 더블샷 적용 안 됨');
    return;
  }
  doubleShotMode = !doubleShotMode;
  showToast(doubleShotMode ? '⚡ 더블샷 ON — 한 번 쏘면 같은 곳으로 자동 2발' : '더블샷 OFF');
  updateControls();
}

function selectWeapon(w) {
  if (!state) return;
  const me = state.players[myId];
  if (!me) return;
  if (state.currentTurn !== myId) return;
  if (w === 'laser_guided' && (me.laserShots ?? 0) <= 0) {
    showToast('⚠️ LASER STRIKE 보유 없음');
    return;
  }
  if (w === 'laser_guided' && doubleShotMode) {
    doubleShotMode = false;
    showToast('🚀 LASER 선택 — 더블샷 자동 OFF');
  }
  currentWeapon = w;
  updateControls();
}

// === Angle / Power input handlers ===
// UI 각도: -90 (왼쪽) ~ 0 (수직 위) ~ +90 (오른쪽)
// 서버 각도: 0 (오른쪽) ~ 90 (수직 위) ~ 180 (왼쪽)
// 변환: server = 90 - ui,  ui = 90 - server
function uiToServerAngle(ui) { return 90 - ui; }
function serverToUiAngle(s) { return 90 - s; }
function formatUiAngle(ui) {
  if (ui > 0) return `+${ui}°`;
  return `${ui}°`;
}

function clampAndApplyAngle(uiVal) {
  if (!Number.isFinite(uiVal)) uiVal = 45;
  uiVal = Math.max(-90, Math.min(90, Math.round(uiVal)));
  angleSlider.value = uiVal;
  if (angleInput) angleInput.value = uiVal;
  socket.emit('setAngle', uiToServerAngle(uiVal));
}

function clampAndApplyPower(v) {
  if (!Number.isFinite(v)) v = 50;
  v = Math.max(5, Math.min(150, Math.round(v)));
  powerSlider.value = v;
  if (powerInput) powerInput.value = v;
  socket.emit('setPower', v);
}

angleSlider.addEventListener('input', (e) => {
  const ui = parseInt(e.target.value);
  if (angleInput) angleInput.value = ui;
  if (angleValue) angleValue.textContent = formatUiAngle(ui);
  socket.emit('setAngle', uiToServerAngle(ui));
});

powerSlider.addEventListener('input', (e) => {
  const v = parseInt(e.target.value);
  if (powerInput) powerInput.value = v;
  socket.emit('setPower', v);
});

if (angleInput) {
  angleInput.addEventListener('change', (e) => clampAndApplyAngle(parseInt(e.target.value)));
  angleInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      clampAndApplyAngle(parseInt(e.target.value));
      e.target.blur();
    }
  });
  angleInput.addEventListener('keyup', (e) => e.stopPropagation());
  angleInput.addEventListener('keypress', (e) => e.stopPropagation());
}

if (powerInput) {
  powerInput.addEventListener('change', (e) => clampAndApplyPower(parseInt(e.target.value)));
  powerInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      clampAndApplyPower(parseInt(e.target.value));
      e.target.blur();
    }
  });
  powerInput.addEventListener('keyup', (e) => e.stopPropagation());
  powerInput.addEventListener('keypress', (e) => e.stopPropagation());
}

if (moveDistInput) {
  moveDistInput.addEventListener('change', (e) => {
    let v = parseInt(e.target.value);
    if (!Number.isFinite(v) || v <= 0) v = 20;
    v = Math.max(1, Math.min(200, v));
    e.target.value = v;
  });
  moveDistInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.target.blur();
    }
  });
  moveDistInput.addEventListener('keyup', (e) => e.stopPropagation());
  moveDistInput.addEventListener('keypress', (e) => e.stopPropagation());
}

function fire() {
  if (!state || state.currentTurn !== myId) return;
  const me = state.players[myId];
  if (!me) return;
  const weaponType = currentWeapon;
  const useDouble = doubleShotMode
    && weaponType !== 'laser_guided'
    && !me.doubleShotPending
    && (me.doubleShots ?? 0) > 0;
  socket.emit('fire', { weaponType, useDouble });
  if (useDouble) {
    doubleShotMode = false;
  }
  btnFire.disabled = true;
}

// Keyboard controls (입력 포커스 시 무시)
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  // 입력 필드 안에서는 게임 단축키 비활성
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;

  // ENTER 키: 인게임에서 채팅 input에 포커스
  if (e.key === 'Enter') {
    if (state && state.phase === 'playing' && gameChatInput) {
      e.preventDefault();
      if (!gameChatOpen) toggleGameChat();
      gameChatInput.focus();
      return;
    }
  }

  if (!state || state.currentTurn !== myId) return;

  const me = state.players[myId];
  if (!me) return;

  const oneShotKeys = ['a', 'A', 'd', 'D', 'x', 'X', ' '];
  if (e.repeat && oneShotKeys.includes(e.key)) return;

  switch (e.key) {
    case 'ArrowLeft': {
      e.preventDefault();
      const cur = parseInt(angleSlider.value);
      const uiNow = Number.isFinite(cur) ? cur : serverToUiAngle(me.angle);
      const uiNext = Math.max(-90, uiNow - 1);
      angleSlider.value = uiNext;
      if (angleInput) angleInput.value = uiNext;
      if (angleValue) angleValue.textContent = formatUiAngle(uiNext);
      socket.emit('setAngle', uiToServerAngle(uiNext));
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const cur = parseInt(angleSlider.value);
      const uiNow = Number.isFinite(cur) ? cur : serverToUiAngle(me.angle);
      const uiNext = Math.min(90, uiNow + 1);
      angleSlider.value = uiNext;
      if (angleInput) angleInput.value = uiNext;
      if (angleValue) angleValue.textContent = formatUiAngle(uiNext);
      socket.emit('setAngle', uiToServerAngle(uiNext));
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const cur = parseInt(powerSlider.value);
      const next = Math.min(150, (Number.isFinite(cur) ? cur : me.power) + 1);
      powerSlider.value = next;
      if (powerInput) powerInput.value = next;
      socket.emit('setPower', next);
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      const cur = parseInt(powerSlider.value);
      const next = Math.max(5, (Number.isFinite(cur) ? cur : me.power) - 1);
      powerSlider.value = next;
      if (powerInput) powerInput.value = next;
      socket.emit('setPower', next);
      break;
    }
    case ' ':
      e.preventDefault();
      fire();
      break;
    case 'a': case 'A':
      e.preventDefault();
      moveTankOnce(-1);
      break;
    case 'd': case 'D':
      e.preventDefault();
      moveTankOnce(1);
      break;
    case 'x': case 'X':
      e.preventDefault();
      toggleDoubleShot();
      break;
  }
});

// ==========================================
//  Scoreboard
// ==========================================

function showScoreboard() {
  if (!state) return;

  scoreTitle.textContent = 'GAME OVER';

  // 카운트다운 안내 (gameoverInfo가 누락된 경우 안전망)
  if (!gameoverEndsAt) {
    gameoverEndsAt = Date.now() + 5000;
    startGameoverCountdown();
  } else if (!gameoverCountdownTimer) {
    startGameoverCountdown();
  }

  const entries = Object.keys(state.scores)
    .filter(id => state.players[id])
    .map(id => ({
      name: state.players[id].name,
      color: state.players[id].color,
      score: state.scores[id] || 0,
    }))
    .sort((a, b) => b.score - a.score);

  let html = '';
  entries.forEach((entry, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const medal = i < 3 ? medals[i] : `#${i + 1}`;
    html += `<div class="score-entry">
      <span class="rank">${medal}</span>
      <span class="s-name" style="color: ${entry.color};">${entry.name}</span>
      <span class="s-score">${entry.score}</span>
    </div>`;
  });

  scoreList.innerHTML = html;
}

// ==========================================
//  Toast notification
// ==========================================

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==========================================
//  Particles
// ==========================================

function spawnExplosion(x, y, radius) {
  const count = 40 + Math.floor(radius);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 1;
    const colors = ['#FF4757', '#FFA502', '#ECCC68', '#FF6B81', '#fff'];
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * 2,
      alpha: 1,
      size: Math.random() * 4 + 1,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 40 + Math.random() * 30,
      maxLife: 40 + Math.random() * 30,
    });
  }
}

function updateParticles() {
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.vx *= 0.98;
    p.life--;
    p.alpha = p.life / p.maxLife;
    return p.life > 0;
  });

  trailParticles = trailParticles.filter(p => {
    p.life--;
    p.alpha = p.life / 30;
    return p.life > 0;
  });
}

// ==========================================
//  Rendering
// ==========================================

function render() {
  animFrame = requestAnimationFrame(render);
  if (!state || state.phase === 'lobby') return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawSky();
  drawStars();
  drawClouds();
  drawTerrain();
  drawItemBoxes();
  drawTanks();
  drawProjectile();
  drawAirstrike();
  drawParticles();
  drawTrail();

  updateParticles();
  updateClouds();
}

function drawItemBoxes() {
  if (!state || !state.itemBoxes) return;
  const time = Date.now() / 500;
  state.itemBoxes.forEach(box => {
    const wobble = Math.sin(time + (box.wobblePhase || 0)) * 4;
    const y = box.y + wobble;
    const x = box.x;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 217, 61, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y - 32, 18, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 14); ctx.lineTo(x - 14, y - 30);
    ctx.moveTo(x + 10, y - 14); ctx.lineTo(x + 14, y - 30);
    ctx.stroke();
    ctx.shadowColor = '#FFD93D';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#FFA502';
    ctx.fillRect(x - 16, y - 14, 32, 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFD93D';
    ctx.fillRect(x - 13, y - 11, 26, 24);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 13, y + 1); ctx.lineTo(x + 13, y + 1);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 13);
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '700 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', x, y + 1);
    ctx.restore();
  });
}

function drawAirstrike() {
  const a = state?.airstrike;
  if (!a) return;
  const elapsed = Date.now() - a.startTime;
  const incoming = a.incomingMs || 1800;
  const linger = a.lingerMs || 1500;
  if (elapsed > incoming + linger + 500) return;

  drawAirstrikeMarker(a, elapsed, incoming);
  drawAirstrikeLabel(a, elapsed, incoming);

  switch (a.kind) {
    case 'f22_carpet':      drawF22Carpet(a, elapsed, incoming, linger); break;
    case 'army_missile':    drawKoreanArmy(a, elapsed, incoming, linger); break;
    case 'drone_grenade':   drawDroneGrenade(a, elapsed, incoming, linger); break;
    case 'kamikaze':        drawKamikaze(a, elapsed, incoming, linger); break;
    case 'satellite_laser': drawSatelliteLaser(a, elapsed, incoming, linger); break;
    default:                drawDefaultBomber(a, elapsed, incoming, linger); break;
  }
}

function drawAirstrikeMarker(a, elapsed, incoming) {
  if (elapsed >= incoming + 200) return;
  const pulse = 0.4 + Math.sin(elapsed / 70) * 0.45;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 71, 87, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(a.targetX, a.targetY - 5, 55, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(a.targetX, a.targetY - 5, 35, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.targetX - 65, a.targetY - 5); ctx.lineTo(a.targetX - 25, a.targetY - 5);
  ctx.moveTo(a.targetX + 25, a.targetY - 5); ctx.lineTo(a.targetX + 65, a.targetY - 5);
  ctx.moveTo(a.targetX, a.targetY - 70); ctx.lineTo(a.targetX, a.targetY - 30);
  ctx.moveTo(a.targetX, a.targetY + 20); ctx.lineTo(a.targetX, a.targetY + 60);
  ctx.stroke();
  ctx.restore();
}

function drawAirstrikeLabel(a, elapsed, incoming) {
  if (elapsed > incoming + 600) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, elapsed / 400);
  ctx.font = '700 14px "Pretendard", "Noto Sans KR", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(a.targetX - 80, 12, 160, 26);
  ctx.fillStyle = '#FFD93D';
  ctx.fillText(`${a.tankFlag || ''} ${a.ultName || 'AIR STRIKE'}`, a.targetX, 30);
  ctx.restore();
}

// === 기본 폭격기 (LEO2 / default) ===
function drawDefaultBomber(a, elapsed, incoming, linger) {
  const fromLeft = a.targetX < canvas.width / 2;
  const startX = fromLeft ? -120 : canvas.width + 120;
  const endX = fromLeft ? canvas.width + 120 : -120;
  let bomberX;
  if (elapsed <= incoming) {
    const t = elapsed / incoming;
    bomberX = startX + (a.targetX - startX) * (1 - Math.pow(1 - t, 2));
  } else {
    const tAfter = Math.min(1, (elapsed - incoming) / linger);
    bomberX = a.targetX + (endX - a.targetX) * tAfter;
  }
  const bomberY = 70;
  ctx.save();
  ctx.translate(bomberX, bomberY);
  if (!fromLeft) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 8, 28, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3a55';
  ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(20, -5); ctx.lineTo(34, 0); ctx.lineTo(20, 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c2c44';
  ctx.beginPath(); ctx.moveTo(-5, -3); ctx.lineTo(8, -16); ctx.lineTo(14, -16); ctx.lineTo(6, -3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-25, -1); ctx.lineTo(-30, -12); ctx.lineTo(-22, -12); ctx.lineTo(-18, -1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7CC4FF';
  ctx.beginPath(); ctx.ellipse(8, -3, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (elapsed > incoming - 300 && elapsed < incoming + 100) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 217, 61, 0.7)';
    ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(a.targetX, bomberY + 6); ctx.lineTo(a.targetX, a.targetY - 5); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
}

// === 🇺🇸 F-22 융단폭격 (M1A2) — 빠른 제트기 + 여러 미사일 ===
function drawF22Carpet(a, elapsed, incoming, linger) {
  const fromLeft = a.targetX < canvas.width / 2;
  const startX = fromLeft ? -150 : canvas.width + 150;
  const endX = fromLeft ? canvas.width + 150 : -150;
  let jetX;
  if (elapsed <= incoming) {
    const t = elapsed / incoming;
    jetX = startX + (a.targetX - startX) * t;
  } else {
    const tAfter = Math.min(1, (elapsed - incoming) / linger);
    jetX = a.targetX + (endX - a.targetX) * tAfter;
  }
  const jetY = 55;
  // F-22 본체 (날카로운 화살 모양)
  ctx.save();
  ctx.translate(jetX, jetY);
  if (!fromLeft) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 10, 32, 3, 0, 0, Math.PI * 2); ctx.fill();
  // 날개
  ctx.fillStyle = '#5a6878';
  ctx.beginPath();
  ctx.moveTo(-12, 0); ctx.lineTo(-22, 8); ctx.lineTo(-2, 4); ctx.lineTo(22, 8); ctx.lineTo(12, 0);
  ctx.closePath(); ctx.fill();
  // 본체
  ctx.fillStyle = '#2c3540';
  ctx.beginPath();
  ctx.moveTo(-34, 0); ctx.lineTo(-18, -3); ctx.lineTo(28, -2); ctx.lineTo(36, 0); ctx.lineTo(28, 2); ctx.lineTo(-18, 3);
  ctx.closePath(); ctx.fill();
  // 캐노피
  ctx.fillStyle = '#9bd0ff';
  ctx.beginPath(); ctx.ellipse(14, -2, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  // 노즐 화염
  if (elapsed < incoming) {
    ctx.fillStyle = `rgba(255, 165, 2, ${0.7 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.moveTo(-36, -1); ctx.lineTo(-44 - Math.random() * 6, 0); ctx.lineTo(-36, 1); ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // 융단폭격 미사일 라인 (좌우 여러 개)
  if (elapsed > incoming - 400 && elapsed < incoming + 200) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.85)';
    ctx.lineWidth = 2;
    const spread = 60;
    for (let i = -3; i <= 3; i++) {
      const px = a.targetX + i * (spread / 3);
      const progress = Math.max(0, Math.min(1, (elapsed - (incoming - 400)) / 500 - Math.abs(i) * 0.05));
      const py = jetY + (a.targetY - 5 - jetY) * progress;
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFD93D';
      ctx.beginPath();
      ctx.moveTo(px, py - 5); ctx.lineTo(px - 1.5, py + 3); ctx.lineTo(px + 1.5, py + 3); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

// === 🇰🇷 한화 유도탄 — 좌우에서 육군 등장 → 미사일 발사 (K2) ===
function drawKoreanArmy(a, elapsed, incoming, linger) {
  const fromLeft = a.targetX > canvas.width / 2; // 반대편에서 옴 (목표 향해)
  const groundY = state ? Math.min(canvas.height - 30, getClientTerrainY(a.targetX < canvas.width / 2 ? 100 : canvas.width - 100)) : canvas.height - 50;
  const startX = fromLeft ? -50 : canvas.width + 50;
  const stopX = fromLeft ? 120 : canvas.width - 120;
  let soldierX;
  if (elapsed <= incoming) {
    const t = Math.min(1, elapsed / (incoming - 200));
    soldierX = startX + (stopX - startX) * t;
  } else {
    soldierX = stopX;
  }
  // 군인 도형 (헬멧 + 몸 + 다리 — 걷는 애니메이션)
  ctx.save();
  ctx.translate(soldierX, groundY);
  if (!fromLeft) ctx.scale(-1, 1);
  // 몸
  ctx.fillStyle = '#3a5a3a';
  ctx.fillRect(-4, -16, 8, 12);
  // 헬멧
  ctx.fillStyle = '#2c4a2c';
  ctx.beginPath(); ctx.arc(0, -20, 5, Math.PI, 0); ctx.fill();
  ctx.fillRect(-5, -20, 10, 2);
  // 다리 (걷는 애니메이션)
  const walkPhase = Math.sin(elapsed / 100) * 2;
  ctx.fillStyle = '#2a3a2a';
  ctx.fillRect(-3, -4, 2, 6 + walkPhase);
  ctx.fillRect(1, -4, 2, 6 - walkPhase);
  // 미사일 발사기 (어깨)
  ctx.fillStyle = '#444';
  ctx.fillRect(4, -14, 14, 3);
  ctx.restore();

  // 미사일 발사 (incoming 마지막에)
  if (elapsed > incoming - 400 && elapsed < incoming + 100) {
    const t = Math.max(0, Math.min(1, (elapsed - (incoming - 400)) / 400));
    const launchX = fromLeft ? soldierX + 18 : soldierX - 18;
    const launchY = groundY - 13;
    const mx = launchX + (a.targetX - launchX) * t;
    const my = launchY + (a.targetY - 5 - launchY) * t;
    // 미사일 본체
    ctx.save();
    const angle = Math.atan2(a.targetY - 5 - launchY, a.targetX - launchX);
    ctx.translate(mx, my); ctx.rotate(angle);
    ctx.fillStyle = '#FFA502';
    ctx.fillRect(-8, -2, 14, 4);
    ctx.fillStyle = '#FF4757';
    ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(12, 0); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
    // 화염 꼬리
    ctx.fillStyle = `rgba(255, 165, 2, ${0.7 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(-14 - Math.random() * 5, 0); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function getClientTerrainY(x) {
  if (!state || !state.terrain) return canvas.height - 100;
  const idx = Math.floor(x / 2);
  if (idx < 0) return state.terrain[0];
  if (idx >= state.terrain.length) return state.terrain[state.terrain.length - 1];
  return state.terrain[idx];
}

// === 🇷🇺 드론 수류탄 (T90) — 작은 쿼드콥터가 타겟 위에 떠서 수류탄 떨어뜨림 ===
function drawDroneGrenade(a, elapsed, incoming, linger) {
  const droneStartY = -30;
  const droneTargetY = a.targetY - 80;
  let droneY;
  if (elapsed <= incoming - 300) {
    const t = elapsed / (incoming - 300);
    droneY = droneStartY + (droneTargetY - droneStartY) * t;
  } else if (elapsed <= incoming + 500) {
    droneY = droneTargetY + Math.sin((elapsed - incoming) / 100) * 3;
  } else {
    const tAway = Math.min(1, (elapsed - incoming - 500) / linger);
    droneY = droneTargetY - 100 * tAway;
  }
  const droneX = a.targetX;
  // 드론 본체 (작은 검정 네모)
  ctx.save();
  ctx.translate(droneX, droneY);
  // 프로펠러 (회전 효과 - 투명한 타원)
  const propSpin = (elapsed / 30) % (Math.PI * 2);
  ctx.fillStyle = 'rgba(180, 180, 220, 0.4)';
  [-8, 8].forEach(dx => {
    ctx.beginPath();
    ctx.ellipse(dx, -3, 7, 1.5, propSpin, 0, Math.PI * 2);
    ctx.fill();
  });
  // 본체
  ctx.fillStyle = '#222';
  ctx.fillRect(-5, -2, 10, 4);
  // 다리
  ctx.fillStyle = '#444';
  ctx.fillRect(-8, -3, 2, 1);
  ctx.fillRect(6, -3, 2, 1);
  ctx.restore();

  // 수류탄 (incoming 직전에 떨어짐)
  if (elapsed > incoming - 300 && elapsed < incoming + 100) {
    const t = Math.max(0, Math.min(1, (elapsed - (incoming - 300)) / 300));
    const gx = a.targetX;
    const gy = droneTargetY + (a.targetY - 5 - droneTargetY) * t;
    ctx.save();
    ctx.fillStyle = '#3a5a3a';
    ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(gx - 4, gy); ctx.lineTo(gx + 4, gy); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx, gy + 4); ctx.stroke();
    // 안전핀 라인 (위로 끌려 옴)
    ctx.strokeStyle = 'rgba(255, 217, 61, 0.6)';
    ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(droneX, droneY + 2); ctx.stroke();
    ctx.restore();
  }
}

// === 🇯🇵 카미카제 (T10) — 비행기가 빠르게 타겟으로 돌진 후 자폭 ===
function drawKamikaze(a, elapsed, incoming, linger) {
  if (elapsed > incoming + 100) return;
  const fromLeft = a.targetX < canvas.width / 2;
  const startX = fromLeft ? -60 : canvas.width + 60;
  const startY = 40;
  const t = Math.min(1, elapsed / incoming);
  // 직선 돌진
  const planeX = startX + (a.targetX - startX) * t;
  const planeY = startY + (a.targetY - 5 - startY) * t;
  const angle = Math.atan2(a.targetY - 5 - startY, a.targetX - startX);
  ctx.save();
  ctx.translate(planeX, planeY);
  ctx.rotate(angle);
  if (!fromLeft) {
    // ok
  }
  // 일본 욱일 비행기 (단순화)
  // 동체
  ctx.fillStyle = '#ddd';
  ctx.beginPath();
  ctx.moveTo(-16, 0); ctx.lineTo(-10, -4); ctx.lineTo(14, -2); ctx.lineTo(18, 0); ctx.lineTo(14, 2); ctx.lineTo(-10, 4);
  ctx.closePath(); ctx.fill();
  // 날개 (작은 X)
  ctx.fillStyle = '#bbb';
  ctx.beginPath();
  ctx.moveTo(-2, -2); ctx.lineTo(2, -10); ctx.lineTo(5, -10); ctx.lineTo(2, -2);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 2); ctx.lineTo(2, 10); ctx.lineTo(5, 10); ctx.lineTo(2, 2);
  ctx.closePath(); ctx.fill();
  // 빨간 원 (욱일 표식)
  ctx.fillStyle = '#FF4757';
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  // 프로펠러
  ctx.strokeStyle = 'rgba(200,200,200,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(18, -5); ctx.lineTo(18, 5); ctx.stroke();
  ctx.restore();

  // 화염 꼬리
  if (t > 0.3) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 71, 87, ${0.6 + Math.random() * 0.3})`;
    ctx.lineWidth = 2;
    const tailLen = 30 * (t - 0.3);
    ctx.beginPath();
    ctx.moveTo(planeX, planeY);
    ctx.lineTo(planeX - Math.cos(angle) * tailLen, planeY - Math.sin(angle) * tailLen);
    ctx.stroke();
    ctx.restore();
  }
}

// === 🇨🇳 위성 레이저 (ZTZ99) — 화면 위쪽 위성 + 수직 강력 레이저 ===
function drawSatelliteLaser(a, elapsed, incoming, linger) {
  const satX = a.targetX;
  const satY = 35;
  // 위성 본체
  ctx.save();
  ctx.translate(satX, satY);
  // 태양광 패널 (좌우)
  ctx.fillStyle = '#1E90FF';
  ctx.fillRect(-25, -3, 10, 6);
  ctx.fillRect(15, -3, 10, 6);
  ctx.strokeStyle = '#0a4a8a';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(-25 + i * 2.5, -3); ctx.lineTo(-25 + i * 2.5, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(15 + i * 2.5, -3); ctx.lineTo(15 + i * 2.5, 3); ctx.stroke();
  }
  // 위성 본체
  ctx.fillStyle = '#888';
  ctx.fillRect(-12, -5, 24, 10);
  ctx.fillStyle = '#FFD93D';
  ctx.fillRect(-2, -2, 4, 4);
  // 안테나
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, -12); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -12, 2, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // 조준 페이즈 (incoming 후반)
  if (elapsed > incoming - 600 && elapsed < incoming) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 71, 87, ${0.3 + Math.sin(elapsed / 80) * 0.3})`;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(satX, satY + 5); ctx.lineTo(a.targetX, a.targetY - 5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 레이저 발사 (incoming 직후)
  if (elapsed >= incoming && elapsed < incoming + 800) {
    const laserAlpha = Math.max(0, 1 - (elapsed - incoming) / 800);
    ctx.save();
    // 외부 글로우
    ctx.strokeStyle = `rgba(168, 85, 247, ${laserAlpha * 0.6})`;
    ctx.lineWidth = 20;
    ctx.beginPath(); ctx.moveTo(satX, satY + 5); ctx.lineTo(a.targetX, a.targetY); ctx.stroke();
    // 중간
    ctx.strokeStyle = `rgba(255, 71, 87, ${laserAlpha * 0.85})`;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(satX, satY + 5); ctx.lineTo(a.targetX, a.targetY); ctx.stroke();
    // 코어 (밝은 흰)
    ctx.strokeStyle = `rgba(255, 255, 255, ${laserAlpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(satX, satY + 5); ctx.lineTo(a.targetX, a.targetY); ctx.stroke();
    ctx.restore();
  }
}

function updateClouds() {
  const wind = state?.wind || 0;
  const baseDrift = wind * 20;
  clouds.forEach(c => {
    c.x += baseDrift * c.speed;
    if (c.x > canvas.width + 200) c.x = -200;
    if (c.x < -200) c.x = canvas.width + 200;
  });
}

function drawClouds() {
  clouds.forEach(c => {
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.fillStyle = '#a8b8e0';
    for (let i = 0; i < c.puffs; i++) {
      const offsetX = (i - c.puffs / 2) * 18 * c.scale;
      const offsetY = Math.sin(i * 1.7 + c.seed) * 6 * c.scale;
      const r = (14 + Math.sin(i + c.seed) * 4) * c.scale;
      ctx.beginPath();
      ctx.arc(c.x + offsetX, c.y + offsetY, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#070720');
  grad.addColorStop(0.3, '#0d1030');
  grad.addColorStop(0.7, '#1a1040');
  grad.addColorStop(1, '#2a1535');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawStars() {
  const time = Date.now() / 1000;
  stars.forEach(s => {
    const twinkle = Math.sin(time * s.twinkleSpeed * 10 + s.twinkleOffset) * 0.3 + 0.7;
    ctx.globalAlpha = s.alpha * twinkle;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawTerrain() {
  if (!state.terrain || state.terrain.length === 0) return;

  const terrain = state.terrain;

  ctx.beginPath();
  ctx.moveTo(0, canvas.height);

  for (let i = 0; i < terrain.length; i++) {
    ctx.lineTo(i * 2, terrain[i]);
  }

  ctx.lineTo(canvas.width, canvas.height);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 200, 0, canvas.height);
  grad.addColorStop(0, '#2d5a27');
  grad.addColorStop(0.15, '#3a6b30');
  grad.addColorStop(0.4, '#4a3a20');
  grad.addColorStop(0.7, '#3a2a15');
  grad.addColorStop(1, '#2a1a0a');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < terrain.length; i++) {
    if (i === 0) ctx.moveTo(i * 2, terrain[i]);
    else ctx.lineTo(i * 2, terrain[i]);
  }
  ctx.strokeStyle = 'rgba(46, 213, 115, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < terrain.length; i++) {
    if (i === 0) ctx.moveTo(i * 2, terrain[i]);
    else ctx.lineTo(i * 2, terrain[i]);
  }
  ctx.strokeStyle = 'rgba(123, 237, 159, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTanks() {
  if (!state.players) return;

  Object.values(state.players).forEach(player => {
    if (!player.alive) return;

    const x = player.x;
    const y = player.y;
    const color = player.color;
    const isMyTurn = state.currentTurn === player.id;
    const isMe = player.id === myId;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - 15, y - 4, 30, 12, 3);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - 4, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.roundRect(x - 15, y + 2, 30, 6, [0, 0, 3, 3]);
    ctx.fill();

    const barrelAngle = player.angle * Math.PI / 180;
    const barrelLen = 22;
    const bx = x + Math.cos(barrelAngle) * barrelLen;
    const by = y - 4 - Math.sin(barrelAngle) * barrelLen;

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(bx, by);
    ctx.stroke();

    if (isMyTurn) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = -12; i <= 12; i += 6) {
      ctx.fillRect(x + i - 1, y + 8, 2, 3);
    }

    const hpPct = player.hp / (player.maxHp || 100);
    const hpBarW = 36;
    const hpBarH = 4;
    const hpBarX = x - hpBarW / 2;
    const hpBarY = y - 28;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(hpBarX - 1, hpBarY - 1, hpBarW + 2, hpBarH + 2, 2);
    ctx.fill();

    const hpColor = hpPct > 0.5 ? '#2ED573' : hpPct > 0.25 ? '#FFA502' : '#FF4757';
    ctx.fillStyle = hpColor;
    ctx.beginPath();
    ctx.roundRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH, 2);
    ctx.fill();

    ctx.font = '700 12px "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.fillText(player.name, x, y + 25);

    if (isMyTurn) {
      const arrowY = hpBarY - 20 + Math.sin(Date.now() / 300) * 3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, arrowY + 8);
      ctx.lineTo(x - 6, arrowY);
      ctx.lineTo(x + 6, arrowY);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function drawProjectile() {
  if (!projectile) return;

  const isRedBean = projectile.type === 'redbean';
  const isLaser = projectile.type === 'laser_guided';
  let innerColor = '#fff';
  let outerColor = 'rgba(255, 71, 87, 0.6)';
  let glowColor = '#FF4757';
  let projRadius = 4;
  if (isRedBean) {
    innerColor = '#FF4757'; outerColor = 'rgba(255, 0, 0, 0.8)'; glowColor = '#FF0000'; projRadius = 3;
  } else if (isLaser) {
    innerColor = '#FFD93D'; outerColor = 'rgba(255, 217, 61, 0.7)'; glowColor = '#FFA502'; projRadius = 5;
  }

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = isLaser ? 22 : 15;

  ctx.fillStyle = innerColor;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = outerColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projRadius + 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function drawTrail() {
  trailParticles.forEach(p => {
    ctx.globalAlpha = p.alpha * 0.6;
    ctx.fillStyle = '#FFA502';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ==========================================
//  Start render loop
// ==========================================

render();

setInterval(() => {
  if (state && !state.projectile) {
    projectile = null;
  }
}, 100);
