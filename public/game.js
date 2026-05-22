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
  // 능력치 점수 기반 바 표시
  const SCORE_DIVISOR = 50;
  const scoreOf = {
    hp: (v) => v / 4,
    range: (v) => v * 25,
    move: (v) => v / 8,
  };
  const pct = (score) => Math.min(100, Math.max(0, Math.round((score / SCORE_DIVISOR) * 100)));
  // 장전속도 — NORMAL + bomb2 평균 cooldown (server.js getCooldownMs 공식과 일치)
  // baseCd: normal=1800, redbean=2800 → 평균 2300
  // cd = baseCd + damage * 60
  const computeReloadMs = (t) => {
    const dmgN = (t.ammo && t.ammo.damage) || 30;
    const dmgB = (t.bomb2 && t.bomb2.damage) || 30;
    const cdN = 1800 + dmgN * 60;
    const cdB = 2800 + dmgB * 60;
    return (cdN + cdB) / 2;
  };
  // 바 길이 — 짧을수록 좋음 (inverse)
  // 범위: 3000ms (빠름, 100%) ~ 6000ms (느림, 0%)
  const reloadPct = (ms) => Math.min(100, Math.max(0, Math.round((6000 - ms) / 30)));

  let html = '';
  Object.values(tankTypes).forEach(t => {
    const isSel = (selectedTank === t.id);
    const hpPct = pct(scoreOf.hp(t.hp));
    const rangePct = pct(scoreOf.range(t.range));
    const movePct = pct(scoreOf.move(t.move));
    const reloadMs = computeReloadMs(t);
    const reloadSeconds = (reloadMs / 1000).toFixed(1);
    const rPct = reloadPct(reloadMs);
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
        <div class="ts-row"><span class="ts-label">장전속도</span><span class="ts-bar"><span class="ts-fill speed" style="width:${rPct}%"></span></span><span class="ts-val">${reloadSeconds}s</span></div>
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

  // 동적 맵 너비 (팀전 = 2배). canvas-wrap 비율 유지, max-width: 100vw 로 화면에 비례 축소
  if (state.mapWidth && canvas.width !== state.mapWidth) {
    canvas.width = state.mapWidth;
    const wrap = document.querySelector('.canvas-wrap');
    if (wrap) wrap.style.width = state.mapWidth + 'px';
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
      const me = state && state.players ? state.players[myId] : null;
      const ult = me && tankTypes && tankTypes[me.tankType] ? tankTypes[me.tankType].ultimate : null;
      const ultName = ult ? ult.name : '필살기';
      showToast(`🚀 ${ultName} 획득!`);
      currentWeapon = 'laser_guided';
      doubleShotMode = false;
      spawnPickupBurst();
    } else if (data.type === 'repair') {
      showToast('🔧 수리킷 획득!');
      spawnPickupBurst();
    } else if (data.type === 'nuke') {
      showToast('☢️ 핵폭탄 획득!');
      currentWeapon = 'nuke';
      doubleShotMode = false;
      spawnPickupBurst();
    }
  } else {
    const labelMap = { laser: '필살기', repair: '수리킷', nuke: '☢️ 핵폭탄' };
    showToast(`📦 ${data.playerName || '누군가'} ${labelMap[data.type] || '아이템'} 획득`);
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
  const teamMode = !!state.teamMode;
  // 호스트 토글 동기화
  const teamCb = document.getElementById('teamModeToggle');
  if (teamCb) teamCb.checked = teamMode;

  if (teamMode) {
    // 팀별 슬롯 (A 5명 / B 5명)
    const teamA = players.filter(p => p.team === 'A');
    const teamB = players.filter(p => p.team === 'B');
    const noTeam = players.filter(p => !p.team);
    const renderSlot = (p) => {
      const isMe = p.id === myId;
      const isHost = p.id === state.host;
      const tankDef = (tankTypes && p.tankType && tankTypes[p.tankType]) || null;
      const flag = tankDef ? tankDef.flag : '⬟';
      return `<div class="player-slot filled team-slot" style="border-color: ${p.color}40;">
        <div class="slot-icon" style="color: ${p.color};">${flag}</div>
        <div class="slot-name" style="color: ${p.color};">${isHost ? '👑 ' : ''}${p.name}${isMe ? ' (YOU)' : ''}</div>
      </div>`;
    };
    const emptySlot = () => `<div class="player-slot"><div class="slot-icon">·</div><div class="slot-name">EMPTY</div></div>`;
    const slotsA = teamA.map(renderSlot).join('') + Array.from({length: Math.max(0, 5 - teamA.length)}, emptySlot).join('');
    const slotsB = teamB.map(renderSlot).join('') + Array.from({length: Math.max(0, 5 - teamB.length)}, emptySlot).join('');
    let html = `
      <div class="team-zones">
        <div class="team-zone team-a" onclick="joinTeam('A')">
          <div class="team-label">🅰️ TEAM A (${teamA.length}/5)</div>
          <div class="team-slot-grid">${slotsA}</div>
        </div>
        <div class="team-zone team-b" onclick="joinTeam('B')">
          <div class="team-label">🅱️ TEAM B (${teamB.length}/5)</div>
          <div class="team-slot-grid">${slotsB}</div>
        </div>
      </div>
      ${noTeam.length > 0 ? `<div class="team-unassigned">미배정: ${noTeam.map(p => p.name).join(', ')} — 위 팀 영역 클릭으로 이동</div>` : ''}`;
    playerSlots.innerHTML = html;
  } else {
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
          <div class="slot-name" style="color: ${p.color};">${isHost ? '👑 ' : ''}${p.name}${isMe ? ' (YOU)' : ''}</div>
          <div class="slot-tank">${tankShort}</div>
        </div>`;
      } else {
        html += `<div class="player-slot"><div class="slot-icon">·</div><div class="slot-name">EMPTY</div></div>`;
      }
    }
    playerSlots.innerHTML = html;
  }

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
  const me = state.players[myId];
  // 팀전(실시간)에서는 항상 자기 차례 (cooldown 으로 제한)
  const teamMode = !!state.teamMode;
  const now = Date.now();
  const onCooldown = teamMode && me && (now < (me.cooldownUntil || 0));
  const inSiegeBusy = teamMode && me && (me.siegeMode === 'transforming' || me.siegeMode === 'untransforming');
  const isMyTurn = teamMode ? (!!me && me.alive && !inSiegeBusy && !onCooldown) : (state.currentTurn === myId);

  // 시즈 버튼 표시 (팀전 모드만)
  const btnSiege = document.getElementById('btnSiege');
  if (btnSiege) {
    btnSiege.style.display = teamMode ? '' : 'none';
    if (me) {
      const sm = me.siegeMode || 'idle';
      btnSiege.disabled = inSiegeBusy || !me.alive;
      btnSiege.textContent = sm === 'idle' ? '🛡 SIEGE' : sm === 'sieged' ? '⚓ SIEGE ON' : '⏳ 변환 중...';
      btnSiege.classList.toggle('active', sm === 'sieged');
    }
  }

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

    const budget = me.moveBudget != null ? Math.max(0, Math.round(me.moveBudget)) : 0;
    if (moveBudgetValue) moveBudgetValue.textContent = String(budget);
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
      if (teamMode && onCooldown && me) {
        const remain = ((me.cooldownUntil - now) / 1000).toFixed(1);
        btnFire.innerHTML = `⏳ ${remain}s`;
      } else if (pending) btnFire.innerHTML = '🔥 ...';
      else if (doubleShotMode) btnFire.innerHTML = '🔥 FIRE × 2';
      else btnFire.innerHTML = '🔥 FIRE';
    }

    const laserCount = me.laserShots ?? 0;
    if (laserCountInBtn) laserCountInBtn.textContent = laserCount;
    // ULT 라벨 (탱크별 필살기 이름)
    const ultLabel = document.getElementById('ultLabel');
    if (ultLabel && tankTypes && me.tankType && tankTypes[me.tankType]) {
      const ult = tankTypes[me.tankType].ultimate;
      ultLabel.textContent = ult ? ult.name.toUpperCase() : 'ULT';
    }
    // NUKE 카운트 + 버튼 상태
    const nukeCount = document.getElementById('nukeCount');
    const nukeBtn = document.querySelector('.btn-weapon.w-nuke');
    const nukes = me.nukeShots ?? 0;
    if (nukeCount) nukeCount.textContent = nukes;
    if (nukeBtn) {
      nukeBtn.disabled = !isMyTurn || !!projectile || nukes <= 0;
      nukeBtn.classList.toggle('has-stock', nukes > 0);
    }
    if (currentWeapon === 'nuke' && nukes <= 0) currentWeapon = 'normal';
    weaponButtons.forEach(btn => {
      if (btn.dataset.weapon === 'nuke') {
        btn.classList.toggle('active', currentWeapon === 'nuke');
      }
    });

    // BOMB2 (REDBEAN 자리) 라벨 — 탱크별 동적
    const bomb2Label = document.getElementById('bomb2Label');
    if (bomb2Label && tankTypes && me.tankType && tankTypes[me.tankType]) {
      const bomb2 = tankTypes[me.tankType].bomb2;
      bomb2Label.textContent = bomb2 ? bomb2.name : 'BOMB 2';
    }

    // REPAIR 버튼 상태
    const btnRepair = document.getElementById('btnRepair');
    const repairCount = document.getElementById('repairCount');
    const kits = me.repairKits ?? 0;
    if (repairCount) repairCount.textContent = kits;
    if (btnRepair) {
      btnRepair.disabled = !isMyTurn || !!projectile || kits <= 0;
    }
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
  const optimistic = Math.max(0, Math.round((me.moveBudget ?? 0) - 5));
  if (moveBudgetValue) moveBudgetValue.textContent = String(optimistic);
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
  if (!Number.isFinite(dist) || dist <= 0) dist = 2;   // 기본값 2
  dist = Math.max(1, Math.min(200, dist));
  const actual = Math.min(dist, me.moveBudget ?? 0);
  const optimistic = Math.max(0, Math.round((me.moveBudget ?? 0) - actual));
  if (moveBudgetValue) moveBudgetValue.textContent = String(optimistic);
  socket.emit('moveBy', { direction, distance: dist });
}

function onTeamModeToggle() {
  const cb = document.getElementById('teamModeToggle');
  if (!cb) return;
  socket.emit('setTeamMode', cb.checked);
}

function joinTeam(team) {
  socket.emit('setTeam', team);
}

socket.on('teamFull', (data) => {
  showToast(`⚠️ Team ${data.team} 이미 5명 (정원)`);
});

function toggleSiege() {
  if (!state) return;
  if (!state.teamMode) {
    showToast('⚠️ 시즈모드는 팀전 모드 전용');
    return;
  }
  const me = state.players[myId];
  if (!me) return;
  socket.emit('toggleSiege');
}

function useRepair() {
  if (!state || state.currentTurn !== myId) return;
  const me = state.players[myId];
  if (!me) return;
  if ((me.repairKits ?? 0) <= 0) {
    showToast('⚠️ 수리킷 없음');
    return;
  }
  socket.emit('repair');
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
    showToast('⚠️ 필살기 보유 없음');
    return;
  }
  if (w === 'nuke' && (me.nukeShots ?? 0) <= 0) {
    showToast('⚠️ 핵폭탄 보유 없음');
    return;
  }
  if ((w === 'laser_guided' || w === 'nuke') && doubleShotMode) {
    doubleShotMode = false;
    showToast('⚡ 더블샷 자동 OFF (특수무기)');
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

  // A/D는 누르고 있으면 연속 이동 (repeat 허용). 나머지 단발 액션은 repeat 차단.
  const oneShotKeys = ['x', 'X', ' ', '1', '2', '3', '4', 'r', 'R', 's', 'S'];
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
      // 입력 칸의 dist (기본 2px) 만큼 좌로. 누르고 있으면 연속.
      moveTankByDistance(-1);
      break;
    case 'd': case 'D':
      e.preventDefault();
      moveTankByDistance(1);
      break;
    case 'x': case 'X':
      e.preventDefault();
      toggleDoubleShot();
      break;
    // === 무기 선택 단축키 ===
    case '1':
      e.preventDefault();
      selectWeapon('normal');
      break;
    case '2':
      e.preventDefault();
      selectWeapon('redbean');
      break;
    case '3': {
      e.preventDefault();
      // ULT는 카운트가 있어야 활성. 없으면 알림.
      if ((me.laserShots ?? 0) > 0) selectWeapon('laser_guided');
      else showToast('⚠️ 필살기 없음 (공중 아이템 획득 필요)');
      break;
    }
    case '4': {
      e.preventDefault();
      if ((me.nukeShots ?? 0) > 0) selectWeapon('nuke');
      else showToast('⚠️ NUKE 없음 (공중 아이템 획득 필요)');
      break;
    }
    // === REPAIR / SIEGE ===
    case 'r': case 'R':
      e.preventDefault();
      useRepair();
      break;
    case 's': case 'S':
      e.preventDefault();
      // 시즈는 팀전 모드에서만 — toggleSiege 자체가 모드 체크
      toggleSiege();
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
  drawRadiationZones();
  drawItemBoxes();
  drawTanks();
  drawGuidedTrajectory();
  drawProjectile();
  drawLaserBeams();          // Leopard 2 직선 레이저
  drawNukeMushroom();        // 핵폭탄 버섯구름 (폭발 전 시각)
  drawAirstrike();
  drawParticles();
  drawTrail();
  drawWeatherParticles();   // 마지막: 시야 효과 + 라벨이 다른 요소 위로

  updateParticles();
  updateClouds();
  updateWeatherParticles();
}

// === 핵폭탄 버섯구름 (mushroom phase = 솟아오름, explode phase = 잔여 빛) ===
function drawNukeMushroom() {
  if (!state || !state.nukeEffect) return;
  const n = state.nukeEffect;
  const now = Date.now();
  const elapsed = now - n.startedAt;
  const t = Math.max(0, Math.min(1, elapsed / (n.duration || 1500)));
  ctx.save();
  // 1) 명중 직후 흰 섬광 (0~150ms)
  if (elapsed < 200) {
    const flashA = Math.max(0, 1 - elapsed / 200);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * flashA})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // 2) 버섯구름 솟아오름
  // 줄기 (지면 → 위로 점점 올라감, 시간에 따라 길어짐)
  const stemH = 200 * t;
  const stemW = 24 + 20 * t;
  const baseY = n.y;
  const topY = baseY - stemH;
  // 줄기 그라데이션 (불 → 회색)
  const stemGrad = ctx.createLinearGradient(n.x, baseY, n.x, topY);
  stemGrad.addColorStop(0, 'rgba(255, 165, 2, 0.95)');
  stemGrad.addColorStop(0.3, 'rgba(255, 100, 30, 0.9)');
  stemGrad.addColorStop(0.7, 'rgba(120, 90, 70, 0.85)');
  stemGrad.addColorStop(1, 'rgba(80, 70, 65, 0.75)');
  ctx.fillStyle = stemGrad;
  ctx.beginPath();
  ctx.moveTo(n.x - stemW / 2, baseY);
  ctx.bezierCurveTo(n.x - stemW * 0.7, baseY - stemH * 0.5, n.x - stemW * 0.4, baseY - stemH * 0.8, n.x - stemW * 0.5, topY);
  ctx.lineTo(n.x + stemW * 0.5, topY);
  ctx.bezierCurveTo(n.x + stemW * 0.4, baseY - stemH * 0.8, n.x + stemW * 0.7, baseY - stemH * 0.5, n.x + stemW / 2, baseY);
  ctx.closePath();
  ctx.fill();
  // 머리 (구름) — 줄기 끝점에 큰 동그란 구름
  const capR = 80 * t;
  if (capR > 4) {
    // 외곽 어두운 구름 베이스
    const capGrad = ctx.createRadialGradient(n.x, topY - capR * 0.4, capR * 0.2, n.x, topY - capR * 0.4, capR);
    capGrad.addColorStop(0, 'rgba(255, 180, 80, 0.92)');
    capGrad.addColorStop(0.45, 'rgba(200, 120, 60, 0.9)');
    capGrad.addColorStop(0.8, 'rgba(110, 95, 80, 0.8)');
    capGrad.addColorStop(1, 'rgba(70, 65, 60, 0)');
    ctx.fillStyle = capGrad;
    // 여러 원으로 구름 모양 (4-5개 원)
    const cloudCenters = [
      { dx: 0, dy: -capR * 0.45, r: capR * 0.95 },
      { dx: -capR * 0.55, dy: -capR * 0.25, r: capR * 0.75 },
      { dx: capR * 0.55, dy: -capR * 0.25, r: capR * 0.75 },
      { dx: -capR * 0.25, dy: -capR * 0.7, r: capR * 0.6 },
      { dx: capR * 0.3, dy: -capR * 0.65, r: capR * 0.6 },
    ];
    for (const c of cloudCenters) {
      ctx.beginPath();
      ctx.arc(n.x + c.dx, topY + c.dy, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 3) 폭발 phase — 큰 빨강 링 + 화이트 코어 펄스
  if (n.phase === 'explode') {
    const expT = Math.max(0, Math.min(1, (elapsed - (n.duration || 1500)) / 1000));
    const ringR = 30 + expT * 240;
    ctx.strokeStyle = `rgba(255, 100, 60, ${0.85 * (1 - expT)})`;
    ctx.lineWidth = 6 * (1 - expT) + 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // 두 번째 링
    ctx.strokeStyle = `rgba(255, 200, 100, ${0.6 * (1 - expT)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(n.x, n.y, ringR * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 4) 라벨 ☢️
  ctx.font = '28px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255, 200, 60, ${0.8 * (1 - t * 0.3)})`;
  ctx.fillText('☢️', n.x, topY - 30);
  ctx.restore();
}

// === Leopard 2 직선 레이저 빔 (지형 관통) ===
function drawLaserBeams() {
  if (!state || !state.laserBeams || state.laserBeams.length === 0) return;
  const now = Date.now();
  state.laserBeams.forEach(b => {
    const elapsed = now - b.startedAt;
    const lifeT = Math.max(0, 1 - elapsed / b.duration);
    if (lifeT <= 0) return;
    ctx.save();
    // 외곽 글로우 (굵게)
    ctx.shadowColor = b.color || '#7BD3FF';
    ctx.shadowBlur = 24;
    ctx.strokeStyle = `rgba(123, 211, 255, ${0.45 * lifeT})`;
    ctx.lineWidth = (b.width || 8) * 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    // 메인 빔 (밝은 코어)
    ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(180, 230, 255, ${0.85 * lifeT})`;
    ctx.lineWidth = (b.width || 8);
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    // 중심 흰 코어 (얇게)
    ctx.shadowBlur = 6;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * lifeT})`;
    ctx.lineWidth = Math.max(2, (b.width || 8) * 0.35);
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    // 시작 / 끝 점 글로우
    ctx.shadowBlur = 20;
    ctx.fillStyle = `rgba(180, 230, 255, ${lifeT})`;
    ctx.beginPath();
    ctx.arc(b.x1, b.y1, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x2, b.y2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawItemBoxes() {
  if (!state || !state.itemBoxes) return;
  const time = Date.now() / 500;
  const now = Date.now();
  state.itemBoxes.forEach(box => {
    const x = box.x;
    const type = box.type || 'laser';
    // 낙하 애니메이션 — spawnedAt 이후 1.6초 동안 dropFromY → targetY 로 떨어짐
    const targetY = (box.targetY != null) ? box.targetY : box.y;
    const dropFromY = (box.dropFromY != null) ? box.dropFromY : -40;
    const spawnedAt = box.spawnedAt || now;
    const dropDuration = 1600;  // ms
    const dropElapsed = now - spawnedAt;
    const dropT = Math.max(0, Math.min(1, dropElapsed / dropDuration));
    const eased = dropT * dropT;  // ease-in
    // 비행기 그래픽: 0~0.6초 동안 화면 가로지름, box.x 도달 시점에 박스 드롭
    const planeT = Math.max(0, Math.min(1, dropElapsed / 700));
    const planeStartX = -80;
    const planeX = planeStartX + (box.x + 60 - planeStartX) * planeT;
    const planeY = dropFromY - 8;
    // 박스가 떨어지기 시작하는 건 비행기가 box.x 근처 도달 후 (planeT >= 0.7)
    let y;
    if (dropT < 0.4) {
      y = dropFromY;  // 비행기에서 아직 안 떨어짐
    } else if (dropT < 1) {
      const realDropT = (dropT - 0.4) / 0.6;
      const dropEase = realDropT * realDropT;
      y = dropFromY + (targetY - dropFromY) * dropEase;
    } else {
      // 안착 — wobble 살짝만 (땅에 박힌 모양)
      const settleWobble = Math.sin(time + (box.wobblePhase || 0)) * 1.5;
      y = targetY + settleWobble;
    }

    // 박스 type별 색/아이콘
    let chuteCol, glowCol, boxOuter, boxInner, icon, crossCol;
    if (type === 'repair') {
      chuteCol = 'rgba(46, 213, 115, 0.5)'; glowCol = '#2ED573'; boxOuter = '#2ED573'; boxInner = '#7BED9F'; icon = '🔧'; crossCol = '#0a3a18';
    } else if (type === 'nuke') {
      chuteCol = 'rgba(255, 71, 87, 0.55)'; glowCol = '#FF4757'; boxOuter = '#FF4757'; boxInner = '#FFA502'; icon = '☢️'; crossCol = '#3a0a0e';
    } else {
      chuteCol = 'rgba(255, 217, 61, 0.45)'; glowCol = '#FFD93D'; boxOuter = '#FFA502'; boxInner = '#FFD93D'; icon = '⚡'; crossCol = '#1a1a1a';
    }

    ctx.save();
    // === 비행기 (0~0.7초 동안만, 박스 드롭 직전까지) ===
    if (planeT < 1 && dropT < 0.5) {
      ctx.save();
      ctx.fillStyle = 'rgba(180, 200, 220, 0.95)';
      ctx.strokeStyle = '#3a4252';
      ctx.lineWidth = 1;
      // 몸체
      ctx.beginPath();
      ctx.moveTo(planeX - 18, planeY);
      ctx.lineTo(planeX + 14, planeY);
      ctx.lineTo(planeX + 18, planeY + 3);
      ctx.lineTo(planeX + 14, planeY + 6);
      ctx.lineTo(planeX - 14, planeY + 6);
      ctx.lineTo(planeX - 20, planeY + 3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 날개 (위)
      ctx.fillStyle = 'rgba(150, 170, 195, 0.9)';
      ctx.fillRect(planeX - 4, planeY - 5, 14, 4);
      // 꼬리
      ctx.fillRect(planeX - 18, planeY - 5, 5, 5);
      // 라이트 깜빡임
      const blink = Math.floor(now / 200) % 2;
      ctx.fillStyle = blink ? '#FF4757' : '#FFD93D';
      ctx.beginPath();
      ctx.arc(planeX + 16, planeY + 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // === 패러슈트 (laser/nuke 는 공중 아이템 — 안착 후에도 매달림 유지. repair 는 지면 안착 후 사라짐) ===
    const keepChute = (type === 'laser' || type === 'nuke');
    if (dropT < 1 || keepChute) {
      ctx.fillStyle = chuteCol;
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
    }

    // === 박스 본체 ===
    if (type === 'repair') {
      // 공구박스 — 사다리꼴 + 손잡이 + 🔧
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = 16;
      // 손잡이 (위쪽 반원)
      ctx.fillStyle = '#1a1d24';
      ctx.beginPath();
      ctx.roundRect(x - 8, y - 18, 16, 4, 2);
      ctx.fill();
      ctx.strokeStyle = '#5a6878';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 18, 6, Math.PI + 0.2, -0.2);
      ctx.stroke();
      // 박스 본체 (사다리꼴: 위가 좁음)
      ctx.shadowBlur = 14;
      ctx.fillStyle = boxOuter;
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 14);
      ctx.lineTo(x + 14, y - 14);
      ctx.lineTo(x + 17, y + 14);
      ctx.lineTo(x - 17, y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      // 내부 패널
      ctx.fillStyle = boxInner;
      ctx.beginPath();
      ctx.moveTo(x - 11, y - 11);
      ctx.lineTo(x + 11, y - 11);
      ctx.lineTo(x + 14, y + 11);
      ctx.lineTo(x - 14, y + 11);
      ctx.closePath();
      ctx.fill();
      // 잠금장치
      ctx.fillStyle = '#1a1d24';
      ctx.fillRect(x - 4, y - 3, 8, 5);
      // 아이콘
      ctx.font = '700 14px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText('🔧', x, y + 7);
    } else {
      // 기존 패러슈트 박스 (laser, nuke)
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = 18;
      ctx.fillStyle = boxOuter;
      ctx.fillRect(x - 16, y - 14, 32, 30);
      ctx.shadowBlur = 0;
      ctx.fillStyle = boxInner;
      ctx.fillRect(x - 13, y - 11, 26, 24);
      ctx.strokeStyle = crossCol;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 13, y + 1); ctx.lineTo(x + 13, y + 1);
      ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 13);
      ctx.stroke();
      ctx.font = '700 16px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, x, y + 1);
      if (type === 'nuke') {
        const pulse = 0.5 + Math.sin(Date.now() / 180) * 0.3;
        ctx.strokeStyle = `rgba(255, 71, 87, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.stroke();
      }
    }
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
    case 'b2_carpet':       drawB2Spirit(a, elapsed, incoming, linger); break;
    case 'f22_carpet':      drawB2Spirit(a, elapsed, incoming, linger); break; // 기존 호환
    case 'army_missile':    drawKoreanArmy(a, elapsed, incoming, linger); break;
    case 'drone_grenade':   drawDroneGrenade(a, elapsed, incoming, linger); break;
    case 'kamikaze':        drawKamikaze(a, elapsed, incoming, linger); break;
    case 'satellite_laser': drawSatelliteLaser(a, elapsed, incoming, linger); break;
    case 'stuka_dive':      drawStukaDive(a, elapsed, incoming, linger); break;
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

// === 🇺🇸 B-2 스피릿 스텔스 폭격기 (M1A2) — 측면도 + 일렬 폭탄 투하 ===
function drawB2Spirit(a, elapsed, incoming, linger) {
  const fromLeft = a.targetX < canvas.width / 2;
  const startX = fromLeft ? -180 : canvas.width + 180;
  const endX = fromLeft ? canvas.width + 180 : -180;

  // 시점별 비행기 X 위치 (폭탄 시작 위치 고정용)
  function jetXAt(eAt) {
    if (eAt <= incoming) {
      const t = eAt / incoming;
      return startX + (a.targetX - startX) * (1 - Math.pow(1 - t, 1.5));
    } else {
      const tAfter = Math.min(1, (eAt - incoming) / linger);
      return a.targetX + (endX - a.targetX) * tAfter;
    }
  }
  const jetX = jetXAt(elapsed);
  const jetY = 55;
  const sx = fromLeft ? 1 : -1;

  ctx.save();
  ctx.translate(jetX, jetY);
  ctx.scale(sx, 1);

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 45, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // ===== B-2 측면도 — 매우 낮고 평평한 실루엣 =====
  const grad = ctx.createLinearGradient(0, -8, 0, 6);
  grad.addColorStop(0, '#3a3f48');
  grad.addColorStop(0.5, '#1a1d24');
  grad.addColorStop(1, '#0e1015');
  ctx.fillStyle = grad;

  // 본체 (옆에서 본 모습 — 매끄러운 박쥐 형태)
  ctx.beginPath();
  ctx.moveTo(-44, 2);             // 꼬리 끝 (좌)
  ctx.bezierCurveTo(-30, -2, -15, -5, 0, -6);   // 윗면 - 캐노피 직전
  ctx.bezierCurveTo(15, -6, 30, -4, 44, 0);     // 캐노피 ~ 노즈
  ctx.lineTo(48, 1.5);            // 노즈 끝
  ctx.lineTo(40, 4);              // 아래 우
  ctx.lineTo(-36, 5);             // 아래 좌
  ctx.closePath();
  ctx.fill();

  // 날개 그림자 (옆에서는 얇은 선만)
  ctx.strokeStyle = 'rgba(80, 90, 110, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-30, 2);
  ctx.lineTo(25, 0);
  ctx.stroke();

  // 캐노피 (위쪽 작은 돔, 노즈 근처)
  ctx.fillStyle = '#3a4658';
  ctx.beginPath();
  ctx.ellipse(20, -5, 7, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.6)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(13, -5); ctx.lineTo(27, -5);
  ctx.stroke();

  // 엔진 인테이크 (위쪽, 가운데)
  ctx.fillStyle = '#06080c';
  ctx.fillRect(-8, -3, 8, 2);

  // 폭탄 베이 (배 아래, 가운데)
  const bayOpen = elapsed > incoming - 1000 && elapsed < incoming + 200;
  ctx.fillStyle = bayOpen ? '#1a1d24' : '#0a0c10';
  ctx.fillRect(-6, 3, 12, 3);
  if (bayOpen) {
    ctx.fillStyle = 'rgba(255, 165, 2, 0.6)';
    ctx.fillRect(-5, 4, 10, 0.8);
  }
  ctx.restore();

  // ===== 폭탄 세로 일점 투하 — 8발 모두 targetX 한 곳에 시간차로 순차 낙하 =====
  const bombCount = 8;
  const dropWindowStart = incoming - 500;    // 첫 폭탄 투하
  const dropWindowEnd = incoming + 100;      // 마지막 폭탄 투하
  const dropInterval = (dropWindowEnd - dropWindowStart) / (bombCount - 1);
  const FALL_MS = 800;
  for (let i = 0; i < bombCount; i++) {
    const myDropStart = dropWindowStart + i * dropInterval;
    if (elapsed < myDropStart) continue;
    const localElapsed = elapsed - myDropStart;
    if (localElapsed > FALL_MS + 500) continue;
    // 모든 폭탄의 X = targetX 고정 (한 점에 세로로 떨어짐)
    const bombX = a.targetX;
    // 자유낙하 (가속, 지면 도달까지)
    const fallStart = 30;                    // 화면 위에서부터
    const fallEnd = a.targetY - 2;
    const tFall = Math.min(1, localElapsed / FALL_MS);
    const by = fallStart + (fallEnd - fallStart) * (tFall * tFall);
    if (by > a.targetY) continue;
    // 폭탄 동체
    ctx.fillStyle = '#2a2d36';
    ctx.beginPath();
    ctx.ellipse(bombX, by, 2.2, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 노즈 (아래 뾰족)
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(bombX - 2.2, by + 3);
    ctx.lineTo(bombX, by + 6.5);
    ctx.lineTo(bombX + 2.2, by + 3);
    ctx.closePath();
    ctx.fill();
    // 꼬리 핀
    ctx.fillStyle = '#5a6070';
    ctx.beginPath();
    ctx.moveTo(bombX - 2.5, by - 5);
    ctx.lineTo(bombX - 3.4, by - 3);
    ctx.lineTo(bombX + 3.4, by - 3);
    ctx.lineTo(bombX + 2.5, by - 5);
    ctx.closePath();
    ctx.fill();
  }
}

// === (기존) F-22 함수 — 호환용 alias (안 쓰이지만 남겨둠) ===
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

// === 🇰🇷 천궁2 (K2) — 본인 탱크 옆에 군인 2명 등장, 한 명 무릎 꿇고 발사대, 한 명 옆 지원, 미사일 발사 + 부스터 점화 + 가속 + 유도 명중 ===
function drawKoreanArmy(a, elapsed, incoming, linger) {
  const tankX = a.originX != null ? a.originX : (a.targetX - 200);
  const sideSign = a.targetX >= tankX ? 1 : -1; // 목표 방향으로 군인 등장
  const groundY = getClientTerrainY(tankX + sideSign * 30) - 1;

  // 군인 등장 (incoming 처음 700ms: 탱크 옆으로 걸어나옴)
  const walkPhase = Math.min(1, elapsed / 700);
  const s1BaseX = tankX + sideSign * 24;
  const s2BaseX = tankX + sideSign * 42;
  const s1X = tankX + (s1BaseX - tankX) * walkPhase;
  const s2X = tankX + (s2BaseX - tankX) * walkPhase;

  // === 군인 1 (앞, 무릎 꿇음, 천궁2 발사대 잡음) ===
  ctx.save();
  ctx.translate(s1X, groundY);
  if (sideSign < 0) ctx.scale(-1, 1);
  // 몸통 (무릎 꿇은 자세)
  ctx.fillStyle = '#3a5a3a';
  ctx.fillRect(-4, -14, 8, 11);
  // 헬멧
  ctx.fillStyle = '#2a3f2a';
  ctx.beginPath(); ctx.arc(0, -16, 4, Math.PI, 0); ctx.fill();
  ctx.fillRect(-4, -16, 8, 1.5);
  // 무릎 꿇은 다리 (앞으로 굽음)
  ctx.fillStyle = '#283828';
  ctx.fillRect(-3, -3, 2, 3);   // 앞 다리 짧게
  ctx.fillRect(1.5, -3, 2, 3);
  ctx.fillRect(2, 0, 5, 1.5);   // 무릎 펴진 발
  // 천궁2 발사대 (긴 통 + 발사구)
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(2, -11, 20, 5);
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(20, -12, 4, 7);  // 발사구
  ctx.fillStyle = '#6a6a78';
  ctx.fillRect(0, -10, 4, 3);   // 손잡이 부분
  ctx.restore();

  // === 군인 2 (뒤, 옆에 서 있음, 지원 자세) ===
  ctx.save();
  ctx.translate(s2X, groundY);
  if (sideSign < 0) ctx.scale(-1, 1);
  // 몸통
  ctx.fillStyle = '#3a5a3a';
  ctx.fillRect(-3, -17, 6, 13);
  // 헬멧
  ctx.fillStyle = '#2a3f2a';
  ctx.beginPath(); ctx.arc(0, -19, 4, Math.PI, 0); ctx.fill();
  ctx.fillRect(-4, -19, 8, 1.5);
  // 다리 (서있음 — 걷는 동안만 흔들림)
  const standWalk = walkPhase < 1 ? Math.sin(elapsed / 100) * 1.5 : 0;
  ctx.fillStyle = '#283828';
  ctx.fillRect(-2, -4, 1.6, 5 + standWalk);
  ctx.fillRect(0.6, -4, 1.6, 5 - standWalk);
  // 들고 있는 장비 (무전기 또는 망원경)
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(2.5, -13, 3, 3);
  ctx.restore();

  // === 천궁2 미사일 발사 (군인 도착 후 ~ incoming 끝) ===
  const launchStart = 750;
  if (elapsed > launchStart && elapsed < incoming + 100) {
    const launchT = Math.max(0, Math.min(1, (elapsed - launchStart) / (incoming - launchStart)));
    const launchX = s1BaseX + sideSign * 22;
    const launchY = groundY - 11;

    // 부스터 점화 구간: launchT 0.25~0.4 ("퉁" 발사 → 부스터 점화 → 가속)
    let progress, phase;
    if (launchT < 0.25) {
      // Phase 0: "퉁" 하고 느리게 (바주카 로켓)
      phase = 0;
      progress = launchT * 0.10 / 0.25;        // 0 ~ 0.10
    } else if (launchT < 0.40) {
      // Phase 1: 부스터 점화 (transition)
      phase = 1;
      progress = 0.10 + (launchT - 0.25) * 0.15 / 0.15;   // 0.10 ~ 0.25
    } else {
      // Phase 2: 본격 미사일 가속 → 정확한 명중
      phase = 2;
      progress = 0.25 + (launchT - 0.40) * 0.75 / 0.60;   // 0.25 ~ 1.0
    }
    progress = Math.min(1, progress);

    const mx = launchX + (a.targetX - launchX) * progress;
    const my = launchY + (a.targetY - 5 - launchY) * progress;
    const angle = Math.atan2(a.targetY - 5 - launchY, a.targetX - launchX);

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    if (phase === 0) {
      // 초기 바주카 로켓 (둔탁, 작은 화염)
      ctx.fillStyle = '#8B6F47';
      ctx.fillRect(-8, -2, 14, 4);
      ctx.fillStyle = '#3a3a44';
      ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(11, 0); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255, 165, 2, 0.6)';
      ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(-13, 0); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill();
    } else {
      // 부스터 점화 후 본격 미사일 (날렵, 강한 화염)
      ctx.fillStyle = '#e8e8ec';
      ctx.beginPath();
      ctx.moveTo(-12, 0); ctx.lineTo(-6, -2); ctx.lineTo(11, -1.8); ctx.lineTo(14, 0); ctx.lineTo(11, 1.8); ctx.lineTo(-6, 2);
      ctx.closePath(); ctx.fill();
      // 빨간 띠 (한국 국기 컬러)
      ctx.fillStyle = '#FF4757';
      ctx.fillRect(-3, -1.6, 4, 3.2);
      // 부스터 화염 (phase 1 작게, phase 2 크게)
      const flameLen = phase === 1 ? 10 + Math.random() * 8 : 18 + Math.random() * 14;
      ctx.fillStyle = `rgba(255, 217, 61, ${0.9})`;
      ctx.beginPath();
      ctx.moveTo(-12, -2); ctx.lineTo(-12 - flameLen, 0); ctx.lineTo(-12, 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255, 71, 87, 0.7)`;
      ctx.beginPath();
      ctx.moveTo(-12, -1); ctx.lineTo(-12 - flameLen * 0.55, 0); ctx.lineTo(-12, 1);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 부스터 점화 시각 효과 (transition 시점에 빛 폭발)
    if (phase === 1 && launchT < 0.32) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      const flashR = 6 + (launchT - 0.25) * 60;
      ctx.fillStyle = `rgba(255, 217, 61, ${0.7 - (launchT - 0.25) * 5})`;
      ctx.beginPath(); ctx.arc(mx, my, flashR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // 발사대 발사 시 매연 (군인 1 위치에서)
  if (elapsed > launchStart - 50 && elapsed < launchStart + 200) {
    const smokeT = Math.max(0, (elapsed - (launchStart - 50)) / 250);
    ctx.save();
    ctx.globalAlpha = (1 - smokeT) * 0.5;
    ctx.fillStyle = '#aaa';
    const launchX = s1BaseX + sideSign * 22;
    const launchY = groundY - 11;
    ctx.beginPath();
    ctx.arc(launchX - sideSign * (8 + smokeT * 20), launchY + smokeT * 5, 6 + smokeT * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// === 🇩🇪 Stuka Ju-87 (LEO2) — V 곡선: 급강하 → 폭탄 투하 → 다시 상승 ===
function drawStukaDive(a, elapsed, incoming, linger) {
  if (elapsed > incoming + linger) return;
  // t: 0~1 (incoming), 1~ (linger 상승 후 사라짐)
  const totalT = elapsed / (incoming + linger * 0.5);
  const t = Math.min(1.4, totalT);
  const fromLeft = a.targetX < canvas.width / 2;
  const sx = fromLeft ? a.targetX - 320 : a.targetX + 320;
  const sy = -50;
  const lowestY = a.targetY - 50;          // 최저 비행 고도
  const exitX = fromLeft ? canvas.width + 100 : -100;  // 빠져나가는 끝 (반대편)
  // X: 처음엔 빠르게 타겟쪽으로, 그 후 같은 방향 계속 진행
  const planeX = sx + (exitX - sx) * (t / 1.4);
  // Y: V 곡선 — t=0 (sy 위) → t=0.5 (lowestY 최저) → t=1+ 다시 sy 위로
  const dt = (t - 0.5) * 2;  // -1 ~ +1.8
  const planeY = lowestY + (sy - lowestY) * dt * dt;
  // 비행기 회전 각도 (강하 시 아래, 상승 시 위) — sign by t-0.5
  const pitchSign = t < 0.5 ? 1 : -1;        // 아래 / 위
  const pitchMag = Math.min(0.7, Math.abs(t - 0.5) * 2.2);
  const angle = pitchSign * pitchMag * 0.55;

  ctx.save();
  ctx.translate(planeX, planeY);
  if (fromLeft) ctx.scale(1, 1); else ctx.scale(-1, 1);
  ctx.rotate(fromLeft ? angle : -angle);
  // 동체 (Ju-87 카키)
  ctx.fillStyle = '#5a5840';
  ctx.beginPath();
  ctx.moveTo(-20, 0); ctx.lineTo(-10, -3); ctx.lineTo(15, -3); ctx.lineTo(20, 0); ctx.lineTo(15, 3); ctx.lineTo(-10, 3);
  ctx.closePath(); ctx.fill();
  // 갈매기 날개 (Stuka 특징 — 'W' 모양)
  ctx.fillStyle = '#3a3828';
  ctx.beginPath();
  ctx.moveTo(-3, -2); ctx.lineTo(-8, -10); ctx.lineTo(2, -7); ctx.lineTo(8, -10); ctx.lineTo(4, -2);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-3, 2); ctx.lineTo(-8, 10); ctx.lineTo(2, 7); ctx.lineTo(8, 10); ctx.lineTo(4, 2);
  ctx.closePath(); ctx.fill();
  // 꼬리 날개 (수직)
  ctx.fillStyle = '#3a3828';
  ctx.beginPath();
  ctx.moveTo(-20, -1); ctx.lineTo(-24, -7); ctx.lineTo(-16, -1);
  ctx.closePath(); ctx.fill();
  // 캐노피
  ctx.fillStyle = '#7CC4FF';
  ctx.beginPath(); ctx.ellipse(5, -2, 5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  // 고정 랜딩기어 (Stuka 트레이드마크)
  ctx.fillStyle = '#222';
  ctx.fillRect(-1, 3, 1.5, 5);
  ctx.fillRect(-5, 3, 1.5, 5);
  ctx.beginPath(); ctx.arc(-4.5, 8, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-0.5, 8, 1.5, 0, Math.PI * 2); ctx.fill();
  // 폭탄 (배 아래) — t < 0.75일 때만
  if (t < 0.75) {
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.ellipse(0, 5, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 프로펠러
  ctx.strokeStyle = 'rgba(200,200,200,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(20, -6); ctx.lineTo(20, 6); ctx.stroke();
  ctx.restore();

  // Stuka 사이렌 시각화 — 십자 점선 (특유의 'Jericho Trumpet')
  if (t > 0.25 && t < 0.85) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 217, 61, ${0.4 + Math.sin(elapsed / 40) * 0.3})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(planeX - 14, planeY); ctx.lineTo(planeX + 14, planeY);
    ctx.moveTo(planeX, planeY - 14); ctx.lineTo(planeX, planeY + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 폭탄 떨어짐 — 최저점(t=0.5) 직전부터 자유낙하
  if (t > 0.45 && t < 0.85) {
    const bt = Math.min(1, (t - 0.45) / 0.4);
    // 폭탄은 최저점 시점 비행기 X에서 자유낙하
    const bombStartX = a.targetX; // 최저점에서 떨어지는 위치
    const bombStartY = lowestY;
    const bx = bombStartX + (a.targetX - bombStartX) * bt;
    const by = bombStartY + (a.targetY - 5 - bombStartY) * (bt * bt);
    ctx.save();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(bx, by, 2.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(bx - 2.5, by - 4); ctx.lineTo(bx, by - 6); ctx.lineTo(bx + 2.5, by - 4);
    ctx.closePath(); ctx.fill();
    // 떨어지는 휘파람 라인
    ctx.strokeStyle = 'rgba(255, 217, 61, 0.4)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(bx, bombStartY);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// === 🔥 화염 지역 (중국 화염탄, 10초) ===
function drawFireZone(z, now) {
  const totalLife = (z.endsAt - z.startedAt) || 10000;
  const lifeT = Math.max(0, (z.endsAt - now) / totalLife);
  ctx.save();
  // 불 베이스 (지형 따라 가로 퍼짐)
  const minX = Math.max(0, z.x - z.radius);
  const maxX = Math.min(canvas.width, z.x + z.radius);
  // 모닥불 같은 흔들리는 불꽃 — 여러 개 그림
  const flameCount = 10;
  for (let i = 0; i < flameCount; i++) {
    const fx = minX + ((maxX - minX) * i) / (flameCount - 1);
    const ty = getClientTerrainY(fx);
    // 거리 따른 강도
    const dx = Math.abs(fx - z.x);
    const intensity = Math.max(0, 1 - dx / z.radius);
    // 흔들리는 높이
    const flameH = (20 + Math.sin(now / 80 + i * 1.3) * 6) * intensity * lifeT;
    if (flameH < 1) continue;
    // 외곽 노랑/주황
    const grad = ctx.createLinearGradient(fx, ty, fx, ty - flameH);
    grad.addColorStop(0, `rgba(255, 71, 87, ${0.85 * lifeT})`);
    grad.addColorStop(0.4, `rgba(255, 165, 2, ${0.75 * lifeT})`);
    grad.addColorStop(0.8, `rgba(255, 217, 61, ${0.5 * lifeT})`);
    grad.addColorStop(1, `rgba(255, 217, 61, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(fx - 6 * intensity, ty + 1);
    ctx.quadraticCurveTo(fx - 4 * intensity, ty - flameH * 0.5, fx + Math.sin(now / 100 + i) * 2, ty - flameH);
    ctx.quadraticCurveTo(fx + 4 * intensity, ty - flameH * 0.5, fx + 6 * intensity, ty + 1);
    ctx.closePath();
    ctx.fill();
  }
  // 잔불 빛 (땅 밝게 깜빡)
  ctx.globalCompositeOperation = 'lighter';
  const glowGrad = ctx.createRadialGradient(z.x, getClientTerrainY(z.x), 2, z.x, getClientTerrainY(z.x), z.radius * 1.2);
  glowGrad.addColorStop(0, `rgba(255, 100, 30, ${0.45 * lifeT})`);
  glowGrad.addColorStop(1, 'rgba(255, 100, 30, 0)');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(z.x, getClientTerrainY(z.x), z.radius * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // 떠오르는 불꽃 입자 (스파크)
  if (Math.random() < 0.5 * lifeT) {
    const px = minX + Math.random() * (maxX - minX);
    const py = getClientTerrainY(px) - Math.random() * 20;
    ctx.fillStyle = `rgba(255, 200, 60, ${lifeT})`;
    ctx.beginPath();
    ctx.arc(px, py, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  // 대륙별 기본 색
  let top = '#070720', mid = '#0d1030', bot = '#2a1535';
  const cont = state && state.continent;
  if (cont === 'RU') { top = '#3a4660'; mid = '#5a6680'; bot = '#7a8aa0'; }            // 시베리아 회색 눈
  else if (cont === 'CN') { top = '#5a3e1a'; mid = '#9a6a2a'; bot = '#d8a458'; }       // 사막 황색
  else if (cont === 'KR') { top = '#0a1a30'; mid = '#1a3050'; bot = '#3a5a78'; }       // 한국 푸른
  else if (cont === 'JP') { top = '#0e1a28'; mid = '#1c2c40'; bot = '#3c5060'; }       // 일본 청회색
  else if (cont === 'US') { top = '#0d1d3a'; mid = '#1a2050'; bot = '#2a1535'; }       // 미국 (기본)
  else if (cont === 'DE') { top = '#0d1030'; mid = '#1a1040'; bot = '#2a1535'; }       // 독일 (기본)
  // 날씨 영향 (덮어쓰기)
  if (state && state.weather) {
    const wk = state.weather.kind;
    if (wk === 'rain') { top = '#1a1d24'; mid = '#2a2d34'; bot = '#3a3d44'; }
    else if (wk === 'snow') { top = '#5a6478'; mid = '#7080a0'; bot = '#a0b0c8'; }
    else if (wk === 'typhoon') { top = '#0a0810'; mid = '#1a1418'; bot = '#3a2a30'; }
    else if (wk === 'sandstorm') { top = '#6a4a20'; mid = '#a07040'; bot = '#d09858'; }
  }
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, top);
  grad.addColorStop(0.5, mid);
  grad.addColorStop(1, bot);
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

// === 자연재해 입자 (비/눈/모래/태풍) ===
let weatherParticles = [];
function updateWeatherParticles() {
  if (!state || !state.weather) { weatherParticles = []; return; }
  const w = state.weather.kind;
  const wind = state.wind || 0;
  let target = 0;
  if (w === 'rain') target = 120;
  else if (w === 'snow') target = 80;
  else if (w === 'sandstorm') target = 220;
  else if (w === 'typhoon') target = 180;
  while (weatherParticles.length < target) {
    const p = { x: Math.random() * canvas.width, y: Math.random() * canvas.height * 0.8, kind: w };
    if (w === 'rain') { p.vx = wind * 40 + 1; p.vy = 10 + Math.random() * 4; }
    else if (w === 'typhoon') { p.vx = wind * 80 - 6 + Math.random() * 3; p.vy = 13 + Math.random() * 5; }
    else if (w === 'snow') { p.vx = wind * 20 + (Math.random() - 0.5) * 1.5; p.vy = 1 + Math.random() * 2; p.size = 1 + Math.random() * 2; }
    else if (w === 'sandstorm') { p.vx = 6 + Math.random() * 8; p.vy = (Math.random() - 0.5) * 3; p.size = 1 + Math.random() * 2; }
    weatherParticles.push(p);
  }
  weatherParticles = weatherParticles.filter(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x += canvas.width;
    if (p.x > canvas.width) p.x -= canvas.width;
    return p.y < canvas.height + 10;
  });
}

function drawWeatherParticles() {
  if (!state || !state.weather) return;
  weatherParticles.forEach(p => {
    if (p.kind === 'rain' || p.kind === 'typhoon') {
      ctx.strokeStyle = p.kind === 'typhoon' ? 'rgba(180, 200, 220, 0.85)' : 'rgba(180, 200, 220, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.7, p.y - p.vy * 0.7);
      ctx.stroke();
    } else if (p.kind === 'snow') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'sandstorm') {
      ctx.fillStyle = `rgba(220, 180, 110, ${0.5 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 모래바람 시야 좁힘 — 시야 밖은 확실하게 안 보이게 (거의 완전 차단)
  if (state.weather.kind === 'sandstorm') {
    const me = state.players ? state.players[myId] : null;
    ctx.save();
    if (me && me.alive) {
      // 시야 안: 본인 주변 작은 원만 선명, 바깥은 완전히 가려짐
      const visionInner = 60;    // 완전 선명
      const visionEdge = 240;    // 이 거리 바깥은 완전 차단
      const grad = ctx.createRadialGradient(me.x, me.y - 10, visionInner, me.x, me.y - 10, visionEdge);
      grad.addColorStop(0, 'rgba(180, 130, 60, 0)');
      grad.addColorStop(0.4, 'rgba(170, 120, 55, 0.35)');
      grad.addColorStop(0.75, 'rgba(150, 100, 45, 0.85)');
      grad.addColorStop(1, 'rgba(120, 80, 30, 1)');   // 완전 불투명
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // 시야 원 가장자리에 부드러운 페더 (시야경계 표시)
      ctx.strokeStyle = 'rgba(80, 50, 20, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(me.x, me.y - 10, visionEdge - 30, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 죽은 후/관전: 화면 거의 다 가림 (간신히 윤곽만)
      ctx.fillStyle = 'rgba(140, 90, 30, 0.92)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }
  // 자연재해 라벨
  const wName = { rain: '🌧 폭우', snow: '❄️ 폭설', typhoon: '🌪 태풍', sandstorm: '🟡 모래바람' }[state.weather.kind];
  if (wName) {
    ctx.save();
    ctx.font = '700 16px "Pretendard", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(canvas.width / 2 - 80, 6, 160, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(wName, canvas.width / 2, 25);
    ctx.restore();
  }
}

// === DOT 지역 (우라늄=방사능 흘러내림, 화염탄=불) ===
function drawRadiationZones() {
  if (!state || !state.radiationZones || state.radiationZones.length === 0) return;
  const now = Date.now();
  state.radiationZones.forEach(z => {
    if (z.endsAt < now) return;
    if (z.dotKind === 'fire') {
      drawFireZone(z, now);
      return;
    }
    const totalLife = (z.endsAt - z.startedAt) || 8000;
    const lifeT = Math.max(0, (z.endsAt - now) / totalLife);
    const pulse = 0.55 + Math.sin(now / 220) * 0.35;
    ctx.save();

    // === 지형 따라 흘러내림 (내리막 방향으로 더 멀리, 시간 따라 확산) ===
    const elapsed = now - z.startedAt;
    // 시간 따라 점진 확산 (최대 radius*8 까지)
    const baseSpread = Math.min(z.radius * 8, z.radius * 2 + (elapsed / 1000) * z.radius * 1.5);
    // 좌/우 어느 쪽이 더 내리막인지 판단 (멀리 떨어진 지점 Y 비교)
    const leftTY = getClientTerrainY(Math.max(0, z.x - 60));
    const rightTY = getClientTerrainY(Math.min(canvas.width, z.x + 60));
    const centerTY = getClientTerrainY(z.x);
    // Y가 크면 낮은 지형 (canvas 좌표 하향)
    const leftFlow = leftTY > centerTY ? 1.6 : (leftTY < centerTY ? 0.4 : 1.0);
    const rightFlow = rightTY > centerTY ? 1.6 : (rightTY < centerTY ? 0.4 : 1.0);
    const minX = Math.max(0, z.x - baseSpread * leftFlow);
    const maxX = Math.min(canvas.width, z.x + baseSpread * rightFlow);
    // 두께 감쇠 기준 거리 (회귀 fix — 이전엔 flowRange 미정의로 ReferenceError → ctx state 깨져 탱크 사라짐)
    const flowRange = Math.max(1, baseSpread * Math.max(leftFlow, rightFlow));
    // 위쪽 윤곽 (지형 위 약간 띄움, 중심 두껍게)
    ctx.beginPath();
    ctx.moveTo(minX, getClientTerrainY(minX));
    const step = 3;
    for (let xi = minX; xi <= maxX; xi += step) {
      const ty = getClientTerrainY(xi);
      const dx = Math.abs(xi - z.x);
      // 중심에 가까울수록 두꺼움 (감쇠), 양 끝은 얇음
      const ratio = Math.max(0, 1 - dx / flowRange);
      const thickness = ratio * z.radius * 0.9 + 0.5;
      // 약간의 wobble (액체스러움)
      const wobble = Math.sin((xi + now * 0.03) / 8) * 1.2 * ratio;
      ctx.lineTo(xi, ty - thickness + wobble);
    }
    // 아래쪽 — 지형 표면 따라 돌아옴
    for (let xi = maxX; xi >= minX; xi -= step) {
      ctx.lineTo(xi, getClientTerrainY(xi) + 0.5);
    }
    ctx.closePath();
    // 메인 fill (펄스)
    ctx.fillStyle = `rgba(46, 213, 115, ${0.45 * lifeT * pulse})`;
    ctx.fill();
    // 외곽 글로우 stroke
    ctx.strokeStyle = `rgba(123, 237, 159, ${0.55 * lifeT})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // === 중심 진한 펄스 (피해 영역 = z.radius 안) ===
    ctx.fillStyle = `rgba(46, 213, 115, ${0.4 * lifeT * pulse})`;
    ctx.beginPath();
    ctx.arc(z.x, getClientTerrainY(z.x) - z.radius * 0.6, z.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // === ☢ 표식 (회전, 중심 위) ===
    const symY = getClientTerrainY(z.x) - z.radius * 0.6;
    ctx.translate(z.x, symY);
    ctx.rotate(now / 800);
    ctx.fillStyle = `rgba(255, 217, 61, ${0.8 * lifeT})`;
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.arc(0, 0, 9, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // === 떨어지는 방울 입자 (액체 흘러내림) ===
    if (Math.random() < 0.4 * lifeT) {
      const px = z.x + (Math.random() - 0.5) * z.radius * 4;
      const py = getClientTerrainY(px) - Math.random() * 4;
      ctx.fillStyle = `rgba(46, 213, 115, ${0.7 * lifeT})`;
      ctx.beginPath();
      ctx.arc(px, py, 1 + Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// === 정밀 유도탄 (T-10 bomb2) 가이드 점선 — 자기 턴 + guided 무기 선택 시 ===
function drawGuidedTrajectory() {
  if (!state || state.currentTurn !== myId) return;
  if (currentWeapon !== 'redbean') return;
  if (projectile) return;
  const me = state.players[myId];
  if (!me || !tankTypes || !tankTypes[me.tankType]) return;
  const tankDef = tankTypes[me.tankType];
  const bomb2 = tankDef.bomb2;
  if (!bomb2 || bomb2.kind !== 'guided') return;

  // 서버 simulateProjectile + projectile sim과 동일한 물리로 예측
  const angle = me.angle * Math.PI / 180;
  const factor = (tankDef.range || 1.0) * (tankDef.speed || 1.0);
  let vx = Math.cos(angle) * me.power * 0.18 * factor;
  let vy = -Math.sin(angle) * me.power * 0.18 * factor;
  let x = me.x;
  let y = me.y - 20;
  const wind = state.wind || 0;

  ctx.save();
  ctx.strokeStyle = 'rgba(124, 196, 255, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(x, y);

  // 먼저 전체 궤적 길이 추정 (지형 충돌 또는 max iter까지)
  let fullPath = [];
  let tx = x, ty = y, tvx = vx, tvy = vy;
  for (let i = 0; i < 500; i++) {
    const speed = Math.sqrt(tvx * tvx + tvy * tvy);
    const dragMag = 0.0012 * speed;
    tvx += wind * 0.32 + (-tvx * dragMag);
    tvy += 0.15 + (-tvy * dragMag);
    tx += tvx;
    ty += tvy;
    if (tx < -50 || tx > canvas.width + 50 || ty > canvas.height + 50) break;
    fullPath.push({ x: tx, y: ty });
    if (state.terrain) {
      const idx = Math.floor(tx / 2);
      if (idx >= 0 && idx < state.terrain.length && ty >= state.terrain[idx]) break;
    }
  }
  // 앞의 30%만 그리기 (유도라 끝점 노출 안 함)
  const showCount = Math.max(8, Math.floor(fullPath.length * 0.3));
  for (let i = 0; i < showCount && i < fullPath.length; i += 2) {
    ctx.lineTo(fullPath[i].x, fullPath[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 가이드 끝점에 작은 페이드 표식 (impact 위치 노출 X)
  if (fullPath.length > 0 && showCount < fullPath.length) {
    const endPt = fullPath[Math.min(showCount - 1, fullPath.length - 1)];
    ctx.fillStyle = 'rgba(124, 196, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// === 탱크별 실루엣 ===
// 각국 실제 탱크 특징 반영: 포탑 크기/모양, 본체 길이, 부속 (배기관, ERA 블록, 슬랫 장갑, 모듈식 장갑, 랜딩기어 등)
function drawTankHull(player) {
  const x = player.x, y = player.y, color = player.color;
  const tt = player.tankType;
  // === 시즈모드 발판 (지면 각도에 맞춰 사다리꼴로, 양옆 다리는 지면까지 닿게) ===
  if (player.siegeMode === 'sieged' || player.siegeMode === 'transforming' || player.siegeMode === 'untransforming') {
    const phase = player.siegeMode === 'sieged' ? 1
                : player.siegeMode === 'transforming' ? Math.min(1, (Date.now() - (player.siegeChangedAt || 0)) / 4000)
                : Math.max(0, 1 - (Date.now() - (player.siegeChangedAt || 0)) / 4000);
    const legW = 22 * phase;
    // 지면 y (월드 좌표) — 좌/우 다리가 닿을 지면 높이
    // drawTanks 가 player._tiltAngle 좌표계 안에서 호출되므로, 다리 끝 y 도 그 회전 좌표계에 맞춰 계산
    // 회전 좌표계에서 다리 base는 y+4, tip은 살짝 더 아래로 — 지면에 박힌 모양
    const t = player._tiltAngle || 0;
    // tilt 가 있을 땐 한쪽 다리는 더 깊이, 한쪽은 얕게 박힘 (회전된 좌표계에서 추가 dy)
    // canvas 좌표 yR > yL = 오른쪽 지면이 낮음 → tilt > 0 → 회전 후 오른쪽 다리는 더 멀리 박힘
    const tipExtra = Math.abs(t) * 14;  // 기울기 비례 추가 박힘 길이
    const leftTipY  = y + 11 + (t < 0 ? tipExtra : 0);   // 왼쪽 지면이 낮으면 (t<0) 왼쪽 더 깊이
    const rightTipY = y + 11 + (t > 0 ? tipExtra : 0);   // 오른쪽 지면이 낮으면 (t>0) 오른쪽 더 깊이
    ctx.save();
    ctx.shadowColor = '#FFD93D';
    ctx.shadowBlur = phase > 0.5 ? 10 : 0;
    const grad = ctx.createLinearGradient(x, y + 4, x, y + 14);
    grad.addColorStop(0, '#5a6878');
    grad.addColorStop(1, '#2a2e38');
    ctx.fillStyle = grad;
    // 왼쪽 다리 사다리꼴
    ctx.beginPath();
    ctx.moveTo(x - 18,        y + 4);
    ctx.lineTo(x - 18,        y + 11);
    ctx.lineTo(x - 18 - legW, leftTipY);
    ctx.lineTo(x - 18 - legW, y + 4);
    ctx.closePath();
    ctx.fill();
    // 오른쪽 다리 사다리꼴
    ctx.beginPath();
    ctx.moveTo(x + 18,        y + 4);
    ctx.lineTo(x + 18,        y + 11);
    ctx.lineTo(x + 18 + legW, rightTipY);
    ctx.lineTo(x + 18 + legW, y + 4);
    ctx.closePath();
    ctx.fill();
    // 외곽선
    ctx.strokeStyle = '#1a1d24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 18,        y + 4); ctx.lineTo(x - 18,        y + 11);
    ctx.lineTo(x - 18 - legW, leftTipY); ctx.lineTo(x - 18 - legW, y + 4); ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 18,        y + 4); ctx.lineTo(x + 18,        y + 11);
    ctx.lineTo(x + 18 + legW, rightTipY); ctx.lineTo(x + 18 + legW, y + 4); ctx.closePath();
    ctx.stroke();
    // 다리 안 리벳
    ctx.fillStyle = '#FFD93D';
    for (let i = 4; i < legW; i += 6) {
      ctx.fillRect(x - 18 - legW + i, y + 6, 2, 2);
      ctx.fillRect(x + 18 + i, y + 6, 2, 2);
    }
    // 다리 끝 — 지면에 박힌 못 (땅에 꽂힌 표현)
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x - 18 - legW - 2, leftTipY - 1, 4, 4);
    ctx.fillRect(x + 18 + legW - 2, rightTipY - 1, 4, 4);
    ctx.restore();
  }
  // 측면 펜더 (모두 공통)
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(x - 16, y + 3, 32, 5, [0, 0, 2, 2]);
  ctx.fill();
  switch (tt) {
    case 'K2': {
      // 한국 K2 흑표 — 슬림 본체 + 평평한 낮은 포탑
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 17, y - 2, 34, 11, 2); ctx.fill();
      // 평평한 포탑 (낮음)
      ctx.beginPath(); ctx.roundRect(x - 10, y - 9, 20, 7, [3, 3, 1, 1]); ctx.fill();
      // 포탑 상단 디테일 (조준경)
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + 3, y - 10, 4, 2);
      break;
    }
    case 'M1A2': {
      // 미국 M1A2 — 두꺼운 본체 + 큰 박스형 포탑
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 18, y - 4, 36, 13, 2); ctx.fill();
      // 큰 박스형 포탑
      ctx.beginPath(); ctx.roundRect(x - 12, y - 13, 24, 11, [2, 2, 1, 1]); ctx.fill();
      // 포탑 뒤쪽 컨테이너 (특징적)
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x - 11, y - 8, 6, 5);
      // 배기관 (오른쪽 후방)
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + 13, y - 2, 5, 4);
      break;
    }
    case 'T90': {
      // 러시아 T-90 — 매우 낮고 둥근 포탑 + ERA 블록
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 16, y - 1, 32, 10, 3); ctx.fill();
      // 둥근 낮은 포탑 (반원)
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 12, 6, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 12, y - 6, 24, 5);
      // ERA 폭발 반응장갑 블록 (앞면)
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - 11, y - 11, 3, 3);
      ctx.fillRect(x - 7, y - 11, 3, 3);
      ctx.fillRect(x - 3, y - 11, 3, 3);
      ctx.fillRect(x + 1, y - 11, 3, 3);
      ctx.fillRect(x + 5, y - 11, 3, 3);
      break;
    }
    case 'LEO2': {
      // 독일 Leopard 2 — 길고 평평한 본체 + 각진 박스 포탑
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 18, y - 3, 36, 12, 1); ctx.fill();
      // 각진 포탑 (앞이 비스듬한 사다리꼴)
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 3);
      ctx.lineTo(x - 12, y - 11);
      ctx.lineTo(x + 4, y - 11);
      ctx.lineTo(x + 12, y - 5);
      ctx.lineTo(x + 12, y - 3);
      ctx.closePath(); ctx.fill();
      // 슬랫 장갑 (사이드)
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(x - 17 + i * 7, y + 4, 1.5, 3);
      }
      break;
    }
    case 'T10': {
      // 일본 10식 — 컴팩트 본체 + 모듈식 장갑
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 14, y - 2, 28, 11, 2); ctx.fill();
      // 작은 평평한 포탑
      ctx.beginPath(); ctx.roundRect(x - 9, y - 10, 18, 8, [3, 3, 1, 1]); ctx.fill();
      // 모듈식 장갑 패널 (옆면 사각 패널)
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - 13, y - 1, 5, 4);
      ctx.fillRect(x - 6, y - 1, 5, 4);
      ctx.fillRect(x + 1, y - 1, 5, 4);
      ctx.fillRect(x + 8, y - 1, 5, 4);
      // 포탑 상단 (날렵한 라인)
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x - 8, y - 10, 16, 1);
      break;
    }
    case 'ZTZ99': {
      // 중국 ZTZ-99 — T-72 계열, 낮은 본체 + 둥근 작은 포탑
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 17, y - 1, 34, 10, 2); ctx.fill();
      // 둥근 포탑 (작고 낮음)
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 10, 5, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 10, y - 5, 20, 4);
      // 포탑 위 광학 장비 (직사각형)
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x - 3, y - 11, 4, 3);
      // 측면 사이드 스커트
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - 17, y + 5, 34, 3);
      break;
    }
    default: {
      // 기본 (LEO2 외 그 외 fallback)
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x - 15, y - 4, 30, 12, 3); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 4, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawTankBarrel(player, isMyTurn) {
  ctx.save();   // ★ ctx 상태 누수 차단 — 함수 끝에서 restore
  const x = player.x, y = player.y, color = player.color;
  const tt = player.tankType;
  let len = 22, width = 4, offY = -4;
  switch (tt) {
    case 'K2':    len = 26; width = 3;   offY = -7;  break;  // 길고 슬림
    case 'M1A2':  len = 24; width = 5;   offY = -9;  break;  // 굵음
    case 'T90':   len = 22; width = 3.5; offY = -6;  break;  // 표준
    case 'LEO2':  len = 28; width = 3;   offY = -7;  break;  // 장거리 = 가장 김
    case 'T10':   len = 20; width = 3;   offY = -7;  break;  // 짧음
    case 'ZTZ99': len = 22; width = 3.5; offY = -5;  break;  // 표준
  }
  // 시즈모드 — 포신 길어짐 (1.5배)
  if (player.siegeMode === 'sieged') len *= 1.5;
  else if (player.siegeMode === 'transforming') {
    const phase = Math.min(1, (Date.now() - (player.siegeChangedAt || 0)) / 4000);
    len *= (1 + 0.5 * phase);
  } else if (player.siegeMode === 'untransforming') {
    const phase = Math.max(0, 1 - (Date.now() - (player.siegeChangedAt || 0)) / 4000);
    len *= (1 + 0.5 * phase);
  }
  const angle = player.angle * Math.PI / 180;
  const startX = x;
  const startY = y + offY;
  const bx = startX + Math.cos(angle) * len;
  const by = startY - Math.sin(angle) * len;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(bx, by);
  ctx.stroke();
  // M1A2: 굵은 머즐 브레이크 (포구 제동기)
  if (tt === 'M1A2') {
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (isMyTurn) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();   // ★ shadow/strokeStyle 등 모두 원복
}

function drawTanks() {
  if (!state.players) return;

  Object.values(state.players).forEach(player => {
    if (!player.alive) return;

    const x = player.x;
    const y = player.y;
    // NaN/Infinity 가드 — 좌표가 깨지면 그리지 않고 스킵 (탱크 사라짐 방지)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const color = player.color;
    const isMyTurn = state.currentTurn === player.id;
    const isMe = player.id === myId;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 지형 기울기에 따라 탱크 회전 (시즈모드일 땐 회전 X — 발판으로 고정)
    let tiltAngle = 0;
    if (player.siegeMode !== 'sieged' && state.terrain && state.terrain.length > 0) {
      const xL = Math.max(0, Math.floor((x - 16) / 2));
      const xR = Math.min(state.terrain.length - 1, Math.floor((x + 16) / 2));
      const yL = state.terrain[xL];
      const yR = state.terrain[xR];
      if (Number.isFinite(yL) && Number.isFinite(yR)) {
        const t = Math.atan2(yR - yL, 32);
        if (Number.isFinite(t)) {
          tiltAngle = Math.max(-0.7, Math.min(0.7, t));
        }
      }
    }
    // 최종 NaN 방어
    if (!Number.isFinite(tiltAngle)) tiltAngle = 0;
    // 탱크 객체에 저장 (drawTankHull의 siege-legs가 지면까지 닿게 그리는 데 사용)
    player._tiltAngle = tiltAngle;

    ctx.save();
    if (Math.abs(tiltAngle) > 0.02) {
      ctx.translate(x, y);
      ctx.rotate(tiltAngle);
      ctx.translate(-x, -y);
    }
    // 탱크별 본체 + 포탑 실루엣
    drawTankHull(player);
    // 탱크별 포신 (각도 회전, 다른 길이/굵기)
    drawTankBarrel(player, isMyTurn);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = -12; i <= 12; i += 6) {
      ctx.fillRect(x + i - 1, y + 8, 2, 3);
    }

    // HP 바 — 본인만 표시 (팀전이면 같은 팀도 표시)
    const me0 = state.players[myId];
    const sameTeam = !!(state.teamMode && me0 && me0.team && player.team === me0.team);
    const showHp = isMe || sameTeam;
    const hpBarY = y - 30;
    if (showHp) {
      const hpPct = player.hp / (player.maxHp || 100);
      const hpBarW = 40;
      const hpBarH = 5;
      const hpBarX = x - hpBarW / 2;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(hpBarX - 1, hpBarY - 1, hpBarW + 2, hpBarH + 2, 2);
      ctx.fill();

      const hpColor = hpPct > 0.5 ? '#2ED573' : hpPct > 0.25 ? '#FFA502' : '#FF4757';
      ctx.fillStyle = hpColor;
      ctx.beginPath();
      ctx.roundRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH, 2);
      ctx.fill();

      // HP 숫자 (바 바로 위 작게)
      ctx.font = '600 9px "Orbitron", "Pretendard", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(`${Math.max(0, Math.round(player.hp))}/${player.maxHp || 100}`, x, hpBarY - 3);
    }

    // 이름 (탱크 아래) — 항상 보임
    ctx.font = '700 12px "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.fillText(player.name, x, y + 25);

    // 자기 턴 화살표 (HP 바 위 — HP 숨겨도 보임)
    if (isMyTurn) {
      const arrowY = hpBarY - 22 + Math.sin(Date.now() / 300) * 3;
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
  const shooter = state && state.players && projectile.shooterId ? state.players[projectile.shooterId] : null;
  const tt = shooter ? shooter.tankType : null;

  // 기본
  let innerColor = '#fff';
  let outerColor = 'rgba(255, 71, 87, 0.6)';
  let glowColor = '#FF4757';
  let projRadius = 4;
  let shape = 'circle'; // 'circle' | 'rod' | 'pellet' | 'finned'

  if (projectile.type === 'nuke') {
    // 핵폭탄 — 매우 크고 빨간 점멸
    const pulse = 0.7 + Math.sin(Date.now() / 100) * 0.3;
    innerColor = '#FF4757'; outerColor = `rgba(255, 71, 87, ${pulse})`; glowColor = '#FF0000'; projRadius = 8;
    shape = 'circle';
  } else if (isLaser) {
    innerColor = '#FFD93D'; outerColor = 'rgba(255, 217, 61, 0.7)'; glowColor = '#FFA502'; projRadius = 5;
  } else if (isRedBean) {
    // BOMB2 — 탱크별 디자인
    switch (tt) {
      case 'K2':    innerColor = '#FF4757'; outerColor = 'rgba(255,0,0,0.8)';    glowColor = '#FF0000'; projRadius = 3; break;                  // 빨콩
      case 'M1A2':  innerColor = '#3a2e1f'; outerColor = 'rgba(255,165,2,0.85)'; glowColor = '#FFA502'; projRadius = 3; shape = 'multi4'; break; // 멀티탄 4발 일렬
      case 'T90':   innerColor = '#7BED9F'; outerColor = 'rgba(46,213,115,0.8)'; glowColor = '#2ED573'; projRadius = 4; break;                  // 우라늄 (방사능 녹색)
      case 'T10':   innerColor = '#fff';    outerColor = 'rgba(124,196,255,0.8)'; glowColor = '#7CC4FF'; projRadius = 4; shape = 'rod'; break;   // 유도탄 (흰 막대)
      case 'ZTZ99': innerColor = '#FFD93D'; outerColor = 'rgba(255,165,2,0.7)';  glowColor = '#FFA502'; projRadius = 4; break;                  // 샷건 핀
      default:      innerColor = '#FF4757'; outerColor = 'rgba(255,0,0,0.8)';    glowColor = '#FF0000'; projRadius = 3;
    }
  } else {
    // NORMAL — 탱크별 디자인 (탄종 차별: HE/HEAT/AP/APFSDS)
    switch (tt) {
      case 'K2':    innerColor = '#d8d8dc'; outerColor = 'rgba(255,71,87,0.45)';   glowColor = '#FF4757'; projRadius = 4;   break; // 표준 HE
      case 'M1A2':  innerColor = '#aaa';    outerColor = 'rgba(255,165,2,0.55)';   glowColor = '#FFA502'; projRadius = 5;   break; // 큰 HEAT
      case 'T90':   innerColor = '#cfcfd4'; outerColor = 'rgba(255,71,87,0.45)';   glowColor = '#FF6B81'; projRadius = 4;   shape = 'finned'; break; // AP 화살촉
      case 'T10':   innerColor = '#FFD93D'; outerColor = 'rgba(255,217,61,0.55)';  glowColor = '#FFA502'; projRadius = 3.5; break; // 빠른 HE
      case 'ZTZ99': innerColor = '#d8d8dc'; outerColor = 'rgba(255,71,87,0.45)';   glowColor = '#FF4757'; projRadius = 4;   break; // 표준 HE
      case 'LEO2':  innerColor = '#fff';    outerColor = 'rgba(255,217,61,0.6)';   glowColor = '#FFD93D'; projRadius = 5;   shape = 'rod'; break; // APFSDS 긴 막대
    }
  }

  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = isLaser ? 22 : 15;
  ctx.fillStyle = innerColor;

  if (shape === 'rod') {
    // 막대 (APFSDS / 정밀 유도탄) — 비행 방향 따라 회전
    const ang = Math.atan2(projectile.vy || 0, projectile.vx || 1);
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(ang);
    ctx.fillRect(-projRadius * 2, -projRadius * 0.4, projRadius * 4, projRadius * 0.8);
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-projRadius * 2, -projRadius * 0.4, projRadius * 4, projRadius * 0.8);
  } else if (shape === 'multi4') {
    // 미국 멀티탄 — 발사 직후엔 모여있다가 비행 거리에 따라 점진 분산 (4개 미사일)
    const ang = Math.atan2(projectile.vy || 0, projectile.vx || 1);
    // 발사자에서 떨어진 거리 (분산 정도)
    const shooter2 = state && state.players ? state.players[projectile.shooterId] : null;
    const distFromShooter = shooter2
      ? Math.sqrt((projectile.x - shooter2.x) ** 2 + (projectile.y - shooter2.y) ** 2)
      : 50;
    // 발사 직후 ~50px까지는 모여있고, 그 후 28px까지 분산
    const distFactor = Math.max(0, Math.min(1, (distFromShooter - 30) / 100));
    const spread = 28 * distFactor;
    const offsets = [-spread * 2, -spread, 0, spread];
    offsets.forEach(off => {
      const gx = projectile.x + off;
      const gy = projectile.y;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(ang);
      // 미사일 본체
      ctx.fillStyle = innerColor;
      ctx.fillRect(-projRadius * 2, -projRadius * 0.45, projRadius * 4, projRadius * 0.9);
      // 노즈콘 (앞쪽 뾰족)
      ctx.beginPath();
      ctx.moveTo(projRadius * 2, -projRadius * 0.45);
      ctx.lineTo(projRadius * 3, 0);
      ctx.lineTo(projRadius * 2, projRadius * 0.45);
      ctx.closePath();
      ctx.fill();
      // 꼬리 핀
      ctx.fillStyle = '#888';
      ctx.fillRect(-projRadius * 2.2, -projRadius * 0.8, projRadius * 0.5, projRadius * 1.6);
      // 화염 꼬리
      ctx.fillStyle = `rgba(255, 165, 2, 0.85)`;
      ctx.beginPath();
      ctx.moveTo(-projRadius * 2, -projRadius * 0.35);
      ctx.lineTo(-projRadius * 3.5 - Math.random() * 2.5, 0);
      ctx.lineTo(-projRadius * 2, projRadius * 0.35);
      ctx.closePath();
      ctx.fill();
      // 외곽
      ctx.strokeStyle = outerColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(-projRadius * 2, -projRadius * 0.45, projRadius * 4, projRadius * 0.9);
      ctx.restore();
    });
  } else if (shape === 'pellet') {
    // 멀티탄 펠릿 (3개 작은 점이 모인 모양)
    ctx.beginPath(); ctx.arc(projectile.x - 2, projectile.y - 1, projRadius * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(projectile.x + 2, projectile.y + 1, projRadius * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(projectile.x + 1, projectile.y - 2.5, projRadius * 0.65, 0, Math.PI * 2); ctx.fill();
  } else if (shape === 'finned') {
    // AP 화살촉 (T-90) — 비행 방향 따라 회전
    const ang = Math.atan2(projectile.vy || 0, projectile.vx || 1);
    ctx.translate(projectile.x, projectile.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(projRadius * 1.8, 0);
    ctx.lineTo(-projRadius * 1.2, -projRadius * 0.7);
    ctx.lineTo(-projRadius * 1.2, projRadius * 0.7);
    ctx.closePath();
    ctx.fill();
    // 꼬리 핀 (양옆)
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-projRadius * 1.3, -projRadius, projRadius * 0.7, projRadius * 0.5);
    ctx.fillRect(-projRadius * 1.3, projRadius * 0.5, projRadius * 0.7, projRadius * 0.5);
  } else {
    // 기본 원형
    ctx.beginPath(); ctx.arc(projectile.x, projectile.y, projRadius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(projectile.x, projectile.y, projRadius + 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  // T-90 우라늄탄 — 방사능 꼬리 (녹색 점 2개)
  if (isRedBean && tt === 'T90' && projectile.vx != null) {
    ctx.fillStyle = '#7BED9F';
    ctx.beginPath();
    ctx.arc(projectile.x - projectile.vx * 0.3, projectile.y - projectile.vy * 0.3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(projectile.x - projectile.vx * 0.6, projectile.y - projectile.vy * 0.6, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  // ZTZ-99 샷건탄 — 작은 핀들 (탄두 주변)
  if (isRedBean && tt === 'ZTZ99') {
    ctx.fillStyle = '#444';
    [0, 1, 2, 3].forEach(i => {
      const a = (Math.PI / 2) * i;
      ctx.fillRect(projectile.x + Math.cos(a) * 5 - 0.5, projectile.y + Math.sin(a) * 5 - 1, 1, 2);
    });
  }
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
