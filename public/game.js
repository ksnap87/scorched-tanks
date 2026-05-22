// ==========================================
//  SCORCHED EARTH - Client Game Engine
// ==========================================

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
      html += `<div class="player-slot filled" style="border-color: ${p.color}40;">
        <div class="slot-icon" style="color: ${p.color};">⬟</div>
        <div class="slot-name" style="color: ${p.color};">
          ${isHost ? '👑 ' : ''}${p.name}${isMe ? ' (YOU)' : ''}
        </div>
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
  windArrow.style.transform = `scaleX(${Math.sign(w) || 1})`;
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
      angleSlider.value = me.angle;
      powerSlider.value = me.power;
      if (angleInput) angleInput.value = me.angle;
      if (powerInput) powerInput.value = me.power;
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
function clampAndApplyAngle(v) {
  if (!Number.isFinite(v)) v = 45;
  v = Math.max(0, Math.min(180, Math.round(v)));
  angleSlider.value = v;
  if (angleInput) angleInput.value = v;
  socket.emit('setAngle', v);
}

function clampAndApplyPower(v) {
  if (!Number.isFinite(v)) v = 50;
  v = Math.max(5, Math.min(150, Math.round(v)));
  powerSlider.value = v;
  if (powerInput) powerInput.value = v;
  socket.emit('setPower', v);
}

angleSlider.addEventListener('input', (e) => {
  const v = parseInt(e.target.value);
  if (angleInput) angleInput.value = v;
  socket.emit('setAngle', v);
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
      const next = Math.min(180, (Number.isFinite(cur) ? cur : me.angle) + 1);
      angleSlider.value = next;
      if (angleInput) angleInput.value = next;
      socket.emit('setAngle', next);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const cur = parseInt(angleSlider.value);
      const next = Math.max(0, (Number.isFinite(cur) ? cur : me.angle) - 1);
      angleSlider.value = next;
      if (angleInput) angleInput.value = next;
      socket.emit('setAngle', next);
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
  const total = incoming + linger;
  if (elapsed > total + 500) return;

  if (elapsed < incoming + 200) {
    const pulse = 0.4 + Math.sin(elapsed / 70) * 0.45;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 71, 87, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(a.targetX, a.targetY - 5, 55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.targetX, a.targetY - 5, 35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.targetX - 65, a.targetY - 5);
    ctx.lineTo(a.targetX - 25, a.targetY - 5);
    ctx.moveTo(a.targetX + 25, a.targetY - 5);
    ctx.lineTo(a.targetX + 65, a.targetY - 5);
    ctx.moveTo(a.targetX, a.targetY - 70);
    ctx.lineTo(a.targetX, a.targetY - 30);
    ctx.moveTo(a.targetX, a.targetY + 20);
    ctx.lineTo(a.targetX, a.targetY + 60);
    ctx.stroke();
    ctx.restore();
  }

  const fromLeft = a.targetX < canvas.width / 2;
  const startX = fromLeft ? -120 : canvas.width + 120;
  const endX = fromLeft ? canvas.width + 120 : -120;
  let bomberX;
  if (elapsed <= incoming) {
    const t = elapsed / incoming;
    const k = 1 - Math.pow(1 - t, 2);
    bomberX = startX + (a.targetX - startX) * k;
  } else {
    const tAfter = Math.min(1, (elapsed - incoming) / linger);
    bomberX = a.targetX + (endX - a.targetX) * tAfter;
  }
  const bomberY = 70;

  ctx.save();
  ctx.translate(bomberX, bomberY);
  if (!fromLeft) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 28, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a3a55';
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.lineTo(20, -5);
  ctx.lineTo(34, 0);
  ctx.lineTo(20, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2c2c44';
  ctx.beginPath();
  ctx.moveTo(-5, -3);
  ctx.lineTo(8, -16);
  ctx.lineTo(14, -16);
  ctx.lineTo(6, -3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-25, -1);
  ctx.lineTo(-30, -12);
  ctx.lineTo(-22, -12);
  ctx.lineTo(-18, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7CC4FF';
  ctx.beginPath();
  ctx.ellipse(8, -3, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (Math.floor(elapsed / 200) % 2 === 0) {
    ctx.fillStyle = '#FF4757';
    ctx.beginPath();
    ctx.arc(-22, -1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (elapsed > incoming - 300 && elapsed < incoming + 100) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 217, 61, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.targetX, bomberY + 6);
    ctx.lineTo(a.targetX, a.targetY - 5);
    ctx.stroke();
    ctx.setLineDash([]);
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

    const hpPct = player.hp / 100;
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
