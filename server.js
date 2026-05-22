const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },         // 외부 접속 허용 (ngrok/배포 환경 대비)
  maxHttpBufferSize: 1e6,
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// === Game constants ===
const MAX_PLAYERS = 10;
const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 700;
const TERRAIN_RESOLUTION = 2;
const GRAVITY = 0.15;
const WIND_CHANGE_RANGE = 0.05;
const EXPLOSION_RADIUS = 35;
const TANK_WIDTH = 30;
const TANK_HEIGHT = 16;
const TANK_HP = 100;
const PROJECTILE_DAMAGE = 35;

// Movement & items
const MOVE_RANGE_PER_TURN = 200;
const STARTING_DOUBLE_SHOTS = 2;

// Projectile physics
const WIND_FACTOR = 0.32;
const PROJECTILE_DRAG = 0.0012;

// Laser-guided airstrike
const LASER_DAMAGE = 70;
const LASER_RADIUS = 90;
const AIRSTRIKE_INCOMING_MS = 1800;
const AIRSTRIKE_LINGER_MS = 1500;

// Item boxes
const ITEM_BOX_FIRST_DELAY = 18000;
const ITEM_BOX_RESPAWN = 40000;
const ITEM_BOX_MAX = 2;

// Chat
const CHAT_HISTORY_MAX = 60;
const CHAT_MESSAGE_MAX_LEN = 200;

const TANK_COLORS = [
  '#FF4757', '#2ED573', '#1E90FF', '#FFA502', '#A855F7',
  '#FF6B81', '#7BED9F', '#70A1FF', '#ECCC68', '#5352ED'
];

const TANK_NAMES = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO',
  'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'
];

// === Rooms (multi-room support) ===
const rooms = {};
const nextTurnFlags = {};

function genRoomCode() {
  // 헷갈리는 문자 제외 (I, O, 0, 1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[code]);
  return code;
}

function normalizeRoomId(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return cleaned || null;
}

function createRoom(id) {
  return {
    id,
    host: null,
    phase: 'lobby',
    players: {},
    terrain: [],
    currentTurn: null,
    turnOrder: [],
    turnIndex: 0,
    wind: 0,
    projectile: null,
    explosions: [],
    round: 1,
    maxRounds: 5,
    scores: {},
    turnTimer: null,
    turnTimeLeft: 10,
    itemBoxes: [],
    itemSpawnTimer: null,
    airstrike: null,
    nextItemBoxId: 1,
    chatHistory: [],
    lobbyReturnTimer: null,
  };
}

function getOrCreateRoom(rawId) {
  const norm = normalizeRoomId(rawId) || genRoomCode();
  if (!rooms[norm]) rooms[norm] = createRoom(norm);
  return rooms[norm];
}

function destroyRoom(roomId) {
  const r = rooms[roomId];
  if (!r) return;
  if (r.turnTimer) clearInterval(r.turnTimer);
  if (r.itemSpawnTimer) clearTimeout(r.itemSpawnTimer);
  if (r.lobbyReturnTimer) clearTimeout(r.lobbyReturnTimer);
  delete rooms[roomId];
  delete nextTurnFlags[roomId];
}

function generateTerrain() {
  const terrain = [];
  const points = [];
  const numPoints = 8;

  for (let i = 0; i <= numPoints; i++) {
    const x = (i / numPoints) * CANVAS_WIDTH;
    const y = CANVAS_HEIGHT * 0.35 + Math.random() * CANVAS_HEIGHT * 0.3;
    points.push({ x, y });
  }

  for (let x = 0; x < CANVAS_WIDTH; x += TERRAIN_RESOLUTION) {
    const t = x / CANVAS_WIDTH;
    const idx = Math.floor(t * numPoints);
    const localT = (t * numPoints) - idx;

    const p0 = points[Math.max(0, idx - 1)];
    const p1 = points[idx];
    const p2 = points[Math.min(numPoints, idx + 1)];
    const p3 = points[Math.min(numPoints, idx + 2)];

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * localT +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * localT * localT +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * localT * localT * localT
    );

    terrain.push(Math.max(CANVAS_HEIGHT * 0.2, Math.min(CANVAS_HEIGHT * 0.8, y)));
  }

  return terrain;
}

function getTerrainY(terrain, x) {
  const idx = Math.floor(x / TERRAIN_RESOLUTION);
  if (idx < 0) return terrain[0];
  if (idx >= terrain.length) return terrain[terrain.length - 1];
  return terrain[idx];
}

function placeTanks(room) {
  const playerIds = Object.keys(room.players);
  const numPlayers = playerIds.length;
  if (numPlayers === 0) return;

  const margin = 60;
  const spacing = (CANVAS_WIDTH - margin * 2) / (numPlayers + 1);

  const slots = [];
  for (let i = 0; i < numPlayers; i++) slots.push(margin + spacing * (i + 1));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  playerIds.forEach((id, i) => {
    const jitter = (Math.random() - 0.5) * Math.min(spacing * 0.5, 80);
    const x = Math.max(margin, Math.min(CANVAS_WIDTH - margin, slots[i] + jitter));
    const y = getTerrainY(room.terrain, x);
    room.players[id].x = x;
    room.players[id].y = y - TANK_HEIGHT / 2;
    room.players[id].hp = TANK_HP;
    room.players[id].alive = true;
    room.players[id].angle = 45;
    room.players[id].power = 50;
    room.players[id].doubleShotPending = false;
  });
}

function resetToLobby(room) {
  if (room.lobbyReturnTimer) {
    clearTimeout(room.lobbyReturnTimer);
    room.lobbyReturnTimer = null;
  }
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }
  if (room.itemSpawnTimer) {
    clearTimeout(room.itemSpawnTimer);
    room.itemSpawnTimer = null;
  }

  room.phase = 'lobby';
  room.round = 1;
  room.scores = {};
  room.terrain = [];
  room.currentTurn = null;
  room.turnOrder = [];
  room.turnIndex = 0;
  room.wind = 0;
  room.projectile = null;
  room.explosions = [];
  room.itemBoxes = [];
  room.airstrike = null;
  room.turnTimeLeft = 10;

  Object.values(room.players).forEach(p => {
    p.alive = true;
    p.hp = TANK_HP;
    p.angle = 45;
    p.power = 50;
    p.doubleShots = STARTING_DOUBLE_SHOTS;
    p.doubleShotPending = false;
    p.laserShots = 0;
    p.moveBudget = MOVE_RANGE_PER_TURN;
  });

  broadcastState(room);
}

function startNewRound(room) {
  room.terrain = generateTerrain();
  room.projectile = null;
  room.explosions = [];
  room.wind = (Math.random() - 0.5) * WIND_CHANGE_RANGE * 2;
  room.itemBoxes = [];
  room.airstrike = null;
  if (room.itemSpawnTimer) clearTimeout(room.itemSpawnTimer);
  room.itemSpawnTimer = setTimeout(() => spawnItemBox(room), ITEM_BOX_FIRST_DELAY);

  placeTanks(room);

  const aliveIds = Object.keys(room.players).filter(
    id => room.players[id].alive
  );
  for (let i = aliveIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [aliveIds[i], aliveIds[j]] = [aliveIds[j], aliveIds[i]];
  }
  room.turnOrder = aliveIds;
  room.turnIndex = 0;
  room.currentTurn = room.turnOrder[0];
  room.phase = 'playing';

  resetTurnTimer(room);
  broadcastState(room);
}

function spawnItemBox(room) {
  if (room.phase !== 'playing') return;
  if (room.itemBoxes.length >= ITEM_BOX_MAX) {
    room.itemSpawnTimer = setTimeout(() => spawnItemBox(room), ITEM_BOX_RESPAWN);
    return;
  }
  const x = 220 + Math.random() * (CANVAS_WIDTH - 440);
  const y = 100 + Math.random() * 130;
  room.itemBoxes.push({
    id: room.nextItemBoxId++,
    x, y,
    type: 'laser',
    wobblePhase: Math.random() * Math.PI * 2,
  });
  broadcastState(room);
  room.itemSpawnTimer = setTimeout(() => spawnItemBox(room), ITEM_BOX_RESPAWN);
}

function resetTurnTimer(room) {
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnTimeLeft = 10;
  io.to(room.id).emit('timerUpdate', room.turnTimeLeft);
  room.turnTimer = setInterval(() => {
    if (room.projectile || room.airstrike) return;
    if (room.phase !== 'playing') return;
    room.turnTimeLeft = Math.max(0, room.turnTimeLeft - 1);
    io.to(room.id).emit('timerUpdate', room.turnTimeLeft);
    if (room.turnTimeLeft <= 0) {
      clearInterval(room.turnTimer);
      room.turnTimer = null;
      nextTurn(room);
    }
  }, 1000);
}

function nextTurn(room) {
  if (nextTurnFlags[room.id]) return;
  nextTurnFlags[room.id] = true;
  try { nextTurnInner(room); } finally { nextTurnFlags[room.id] = false; }
}

function nextTurnInner(room) {
  const alivePlayers = Object.keys(room.players).filter(
    id => room.players[id].alive
  );

  const totalPlayers = Object.keys(room.players).length;

  if (alivePlayers.length <= 1 && totalPlayers > 1) {
    if (alivePlayers.length === 1) {
      const winnerId = alivePlayers[0];
      if (!room.scores[winnerId]) room.scores[winnerId] = 0;
      room.scores[winnerId] += 100;
    }

    // 한 명만 살아남으면 즉시 게임 종료 (라운드제 폐지)
    if (room.itemSpawnTimer) { clearTimeout(room.itemSpawnTimer); room.itemSpawnTimer = null; }
    room.itemBoxes = [];
    room.airstrike = null;

    room.phase = 'gameover';
    broadcastState(room);
    if (room.turnTimer) { clearInterval(room.turnTimer); room.turnTimer = null; }

    if (room.lobbyReturnTimer) clearTimeout(room.lobbyReturnTimer);
    room.gameoverEndsAt = Date.now() + 5000;
    io.to(room.id).emit('gameoverInfo', { endsAt: room.gameoverEndsAt });
    room.lobbyReturnTimer = setTimeout(() => resetToLobby(room), 5000);
    return;
  }

  room.wind += (Math.random() - 0.5) * WIND_CHANGE_RANGE;
  room.wind = Math.max(-0.08, Math.min(0.08, room.wind));

  if (!room.turnOrder || room.turnOrder.length === 0) {
    room.turnOrder = alivePlayers;
    room.turnIndex = -1;
  }

  let found = false;
  for (let attempts = 0; attempts < room.turnOrder.length; attempts++) {
    room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
    const candidateId = room.turnOrder[room.turnIndex];
    const candidate = room.players[candidateId];
    if (candidate && candidate.alive) {
      room.currentTurn = candidateId;
      found = true;
      break;
    }
  }
  if (!found) {
    room.currentTurn = null;
    return;
  }

  const active = room.players[room.currentTurn];
  if (active) {
    active.doubleShotPending = false;
  }

  resetTurnTimer(room);
  broadcastState(room);
}

function applyExplosion(room, x, y, weaponType = 'normal') {
  let radius = EXPLOSION_RADIUS;
  let maxDamage = PROJECTILE_DAMAGE;

  if (weaponType === 'redbean') {
    radius = 15;
    maxDamage = 80;
  } else if (weaponType === 'laser_guided') {
    radius = LASER_RADIUS;
    maxDamage = LASER_DAMAGE;
  }

  for (let i = 0; i < room.terrain.length; i++) {
    const tx = i * TERRAIN_RESOLUTION;
    const dx = tx - x;
    if (Math.abs(dx) < radius) {
      const dy = Math.sqrt(radius * radius - dx * dx);
      const terrainY = room.terrain[i];
      if (y - dy < terrainY) {
        room.terrain[i] = Math.min(CANVAS_HEIGHT, terrainY + dy * 0.7);
      }
    }
  }

  Object.keys(room.players).forEach(id => {
    const player = room.players[id];
    if (!player.alive) return;

    const dx = player.x - x;
    const dy = player.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < radius * 1.5) {
      const damage = Math.round(maxDamage * (1 - dist / (radius * 1.5)));
      player.hp = Math.max(0, player.hp - Math.max(damage, 5));
      if (player.hp <= 0) {
        player.alive = false;
        if (room.currentTurn && room.currentTurn !== id) {
          if (!room.scores[room.currentTurn]) room.scores[room.currentTurn] = 0;
          room.scores[room.currentTurn] += 50;
        }
      }
    }
  });

  Object.values(room.players).forEach(player => {
    if (!player.alive) return;

    const oldY = player.y;
    const terrainY = getTerrainY(room.terrain, player.x);
    const newY = terrainY - TANK_HEIGHT / 2;

    const fallDistance = newY - oldY;

    if (fallDistance > 5) {
      const fallDamage = Math.round(fallDistance * 0.66);
      player.hp = Math.max(0, player.hp - fallDamage);

      if (player.hp <= 0) {
        player.alive = false;
        if (room.currentTurn && room.currentTurn !== player.id) {
          if (!room.scores[room.currentTurn]) room.scores[room.currentTurn] = 0;
          room.scores[room.currentTurn] += 50;
        }
      }
    }

    player.y = newY;
  });

  room.explosions.push({ x, y, radius, time: Date.now() });
}

function simulateProjectile(startX, startY, angle, power) {
  const radians = angle * Math.PI / 180;
  const vx = Math.cos(radians) * power * 0.18;
  const vy = -Math.sin(radians) * power * 0.18;

  return { x: startX, y: startY - 20, vx, vy };
}

function startFire(room, player, weaponType, useDouble) {
  if (!player) return false;
  if (room.phase !== 'playing') return false;
  if (room.currentTurn !== player.id) return false;
  if (room.projectile) return false;
  if (!player.alive) return false;

  if (weaponType === 'laser_guided') useDouble = false;

  const wasAlreadyPending = player.doubleShotPending;
  const isFirstOfDouble = useDouble && !wasAlreadyPending;

  if (isFirstOfDouble) {
    if ((player.doubleShots ?? 0) <= 0) return false;
    player.doubleShotPending = true;
    player.doubleShots--;
  }

  let actualWeapon = weaponType;
  if (actualWeapon === 'laser_guided') {
    if ((player.laserShots ?? 0) <= 0) {
      if (wasAlreadyPending) {
        actualWeapon = 'normal';
      } else {
        if (isFirstOfDouble) {
          player.doubleShotPending = false;
          player.doubleShots++;
        }
        return false;
      }
    } else {
      player.laserShots--;
    }
  }

  const proj = simulateProjectile(player.x, player.y, player.angle, player.power);
  proj.type = actualWeapon;
  proj.shooterId = player.id;
  room.projectile = proj;

  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }

  let finished = false;
  const finishShot = () => {
    if (finished) return;
    finished = true;
    if (isFirstOfDouble) {
      setTimeout(() => {
        if (room.phase !== 'playing') return;
        if (room.currentTurn !== player.id) return;
        if (!player.alive) {
          player.doubleShotPending = false;
          nextTurn(room);
          return;
        }
        const ok = startFire(room, player, weaponType, false);
        if (!ok) {
          player.doubleShotPending = false;
          setTimeout(() => nextTurn(room), 800);
        }
      }, 700);
    } else {
      if (player.doubleShotPending) player.doubleShotPending = false;
      setTimeout(() => nextTurn(room), 1000);
    }
  };

  const detonate = (px, py) => {
    if (proj.type === 'laser_guided') {
      room.airstrike = {
        targetX: px,
        targetY: py,
        startTime: Date.now(),
        incomingMs: AIRSTRIKE_INCOMING_MS,
        lingerMs: AIRSTRIKE_LINGER_MS,
        phase: 'incoming',
      };
      broadcastState(room);
      setTimeout(() => {
        applyExplosion(room, px, py, 'laser_guided');
        if (room.airstrike) room.airstrike.phase = 'bombing';
        broadcastState(room);
      }, AIRSTRIKE_INCOMING_MS);
      setTimeout(() => {
        room.airstrike = null;
        broadcastState(room);
        finishShot();
      }, AIRSTRIKE_INCOMING_MS + AIRSTRIKE_LINGER_MS);
    } else {
      applyExplosion(room, px, py, proj.type);
      broadcastState(room);
      finishShot();
    }
  };

  const simInterval = setInterval(() => {
    if (!room.projectile) {
      clearInterval(simInterval);
      return;
    }
    const p = room.projectile;

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const dragMag = PROJECTILE_DRAG * speed;
    p.vx += room.wind * WIND_FACTOR + (-p.vx * dragMag);
    p.vy += GRAVITY + (-p.vy * dragMag);
    p.x += p.vx;
    p.y += p.vy;

    const px = p.x;
    const py = p.y;

    if (px < -50 || px > CANVAS_WIDTH + 50 || py > CANVAS_HEIGHT + 50) {
      room.projectile = null;
      clearInterval(simInterval);
      broadcastState(room);
      finishShot();
      return;
    }

    for (let i = 0; i < room.itemBoxes.length; i++) {
      const box = room.itemBoxes[i];
      const HIT_R = 36;
      const prevX = px - p.vx;
      const prevY = py - p.vy;
      const segDx = px - prevX, segDy = py - prevY;
      const segLen2 = segDx * segDx + segDy * segDy || 1;
      let t = ((box.x - prevX) * segDx + (box.y - prevY) * segDy) / segLen2;
      t = Math.max(0, Math.min(1, t));
      const closestX = prevX + segDx * t;
      const closestY = prevY + segDy * t;
      const dist = Math.sqrt((box.x - closestX) ** 2 + (box.y - closestY) ** 2);
      if (dist < HIT_R) {
        room.itemBoxes.splice(i, 1);
        const shooter = room.players[p.shooterId];
        if (shooter && box.type === 'laser') {
          shooter.laserShots = (shooter.laserShots ?? 0) + 1;
          io.to(room.id).emit('itemPickup', { playerId: shooter.id, playerName: shooter.name, type: 'laser' });
        }
        room.explosions.push({ x: box.x, y: box.y, radius: 24, time: Date.now(), kind: 'box' });
        room.projectile = null;
        clearInterval(simInterval);
        broadcastState(room);
        finishShot();
        return;
      }
    }

    const terrainY = getTerrainY(room.terrain, px);
    if (py >= terrainY) {
      room.projectile = null;
      clearInterval(simInterval);
      detonate(px, terrainY);
      return;
    }

    for (const id of Object.keys(room.players)) {
      const target = room.players[id];
      if (!target.alive) continue;
      const dx = target.x - px;
      const dy = target.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        room.projectile = null;
        clearInterval(simInterval);
        detonate(px, py);
        return;
      }
    }

    io.to(room.id).emit('projectileUpdate', room.projectile);
  }, 16);

  return true;
}

function broadcastState(room) {
  io.to(room.id).emit('gameState', {
    roomId: room.id,
    host: room.host,
    phase: room.phase,
    players: room.players,
    terrain: room.terrain,
    currentTurn: room.currentTurn,
    wind: room.wind,
    projectile: room.projectile,
    explosions: room.explosions,
    round: room.round,
    maxRounds: room.maxRounds,
    scores: room.scores,
    turnTimeLeft: room.turnTimeLeft,
    itemBoxes: room.itemBoxes,
    airstrike: room.airstrike,
  });
}

// === Chat ===
function pushChatToRoom(room, msg) {
  room.chatHistory.push(msg);
  if (room.chatHistory.length > CHAT_HISTORY_MAX) {
    room.chatHistory.splice(0, room.chatHistory.length - CHAT_HISTORY_MAX);
  }
  io.to(room.id).emit('chatMessage', msg);
}

function systemChat(room, text) {
  pushChatToRoom(room, {
    id: 'sys-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'system',
    text,
    time: Date.now(),
  });
}

// === REST helpers ===
app.get('/api/new-room', (req, res) => {
  const code = genRoomCode();
  res.json({ roomId: code, url: `/?room=${code}` });
});

// === Socket.IO ===
io.on('connection', (socket) => {
  const rawRoom = socket.handshake.query && socket.handshake.query.room;
  const room = getOrCreateRoom(rawRoom);
  console.log(`Player connected: ${socket.id} → room ${room.id}`);

  const playerCount = Object.keys(room.players).length;

  if (playerCount >= MAX_PLAYERS) {
    socket.emit('serverFull', { roomId: room.id });
    socket.disconnect();
    return;
  }

  if (room.phase === 'playing') {
    socket.emit('gameInProgress', { roomId: room.id });
    socket.disconnect();
    return;
  }

  socket.join(room.id);
  socket.data.roomId = room.id;

  const usedColors = Object.values(room.players).map(p => p.color);
  let availableColors = TANK_COLORS.filter(c => !usedColors.includes(c));
  if (availableColors.length === 0) availableColors = TANK_COLORS;

  const colorIndex = TANK_COLORS.indexOf(availableColors[0]);
  const assignedColor = availableColors[0];

  if (playerCount === 0 || !room.host) {
    room.host = socket.id;
  }

  room.players[socket.id] = {
    id: socket.id,
    name: TANK_NAMES[colorIndex],
    color: assignedColor,
    x: 0,
    y: 0,
    angle: 45,
    power: 50,
    hp: TANK_HP,
    alive: true,
    moveBudget: MOVE_RANGE_PER_TURN,
    doubleShots: STARTING_DOUBLE_SHOTS,
    doubleShotPending: false,
    laserShots: 0,
  };

  if (!room.scores[socket.id]) {
    room.scores[socket.id] = 0;
  }

  socket.emit('init', { playerId: socket.id, roomId: room.id });
  if (room.chatHistory.length > 0) {
    socket.emit('chatHistory', room.chatHistory);
  }
  broadcastState(room);
  systemChat(room, `${room.players[socket.id].name} 님이 입장했습니다`);

  socket.on('setName', (name) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.players[socket.id]) {
      const cleaned = String(name || '').substring(0, 12).trim();
      if (!cleaned) return;
      const oldName = r.players[socket.id].name;
      r.players[socket.id].name = cleaned;
      broadcastState(r);
      if (oldName !== cleaned) systemChat(r, `${oldName} → ${cleaned}`);
    }
  });

  socket.on('startGame', () => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (socket.id !== r.host) return;
    if (Object.keys(r.players).length >= 1 && r.phase === 'lobby') {
      r.round = 1;
      r.scores = {};
      Object.keys(r.players).forEach(id => {
        r.scores[id] = 0;
        r.players[id].doubleShots = STARTING_DOUBLE_SHOTS;
        r.players[id].doubleShotPending = false;
        r.players[id].laserShots = 0;
        r.players[id].moveBudget = MOVE_RANGE_PER_TURN;
      });
      startNewRound(r);
    }
  });

  // 키보드/버튼 1회 이동 (5px)
  socket.on('move', (direction) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    if (r.currentTurn !== socket.id) return;
    if (r.projectile) return;
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    if (player.moveBudget <= 0) return;

    const dir = direction < 0 ? -1 : 1;
    const desiredStep = Math.min(5, player.moveBudget);
    const newX = Math.max(20, Math.min(CANVAS_WIDTH - 20, player.x + dir * desiredStep));
    const actualStep = Math.abs(newX - player.x);
    if (actualStep === 0) return;

    player.x = newX;
    player.y = getTerrainY(r.terrain, newX) - TANK_HEIGHT / 2;
    player.moveBudget = Math.max(0, player.moveBudget - actualStep);

    broadcastState(r);
  });

  // 거리 지정 이동 (숫자 입력으로 N px 한 번에)
  socket.on('moveBy', (data) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    if (r.currentTurn !== socket.id) return;
    if (r.projectile) return;
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    if (player.moveBudget <= 0) return;

    const direction = (data && data.direction) || 0;
    let requestedDist = parseInt(data && data.distance);
    if (!Number.isFinite(requestedDist) || requestedDist <= 0) return;
    requestedDist = Math.max(1, Math.min(MOVE_RANGE_PER_TURN, requestedDist));

    const dir = direction < 0 ? -1 : 1;
    const desiredStep = Math.min(requestedDist, player.moveBudget);
    const newX = Math.max(20, Math.min(CANVAS_WIDTH - 20, player.x + dir * desiredStep));
    const actualStep = Math.abs(newX - player.x);
    if (actualStep === 0) return;

    player.x = newX;
    player.y = getTerrainY(r.terrain, newX) - TANK_HEIGHT / 2;
    player.moveBudget = Math.max(0, player.moveBudget - actualStep);

    broadcastState(r);
  });

  socket.on('setAngle', (angle) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.players[socket.id] && r.currentTurn === socket.id) {
      const v = parseInt(angle);
      if (!Number.isFinite(v)) return;
      r.players[socket.id].angle = Math.max(0, Math.min(180, v));
      broadcastState(r);
    }
  });

  socket.on('setPower', (power) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.players[socket.id] && r.currentTurn === socket.id) {
      const v = parseInt(power);
      if (!Number.isFinite(v)) return;
      r.players[socket.id].power = Math.max(5, Math.min(150, v));
      broadcastState(r);
    }
  });

  socket.on('fire', (arg) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    const player = r.players[socket.id];
    if (!player) return;
    const data = typeof arg === 'string' ? { weaponType: arg } : (arg || {});
    const weaponType = data.weaponType || 'normal';
    const wantsDouble = data.useDouble === true;
    startFire(r, player, weaponType, wantsDouble);
  });

  socket.on('chatMessage', (text) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    const player = r.players[socket.id];
    if (!player) return;
    let msg = String(text || '').trim();
    if (!msg) return;
    if (msg.length > CHAT_MESSAGE_MAX_LEN) msg = msg.slice(0, CHAT_MESSAGE_MAX_LEN);
    pushChatToRoom(r, {
      id: socket.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'user',
      from: player.name,
      color: player.color,
      text: msg,
      time: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    console.log(`Player disconnected: ${socket.id} from room ${r.id}`);

    const leavingPlayer = r.players[socket.id];
    if (leavingPlayer) {
      systemChat(r, `${leavingPlayer.name} 님이 퇴장했습니다`);
    }

    delete r.players[socket.id];
    delete r.scores[socket.id];

    if (r.host === socket.id) {
      const remaining = Object.keys(r.players);
      r.host = remaining.length > 0 ? remaining[0] : null;
    }

    const remainingCount = Object.keys(r.players).length;
    if (remainingCount === 0) {
      destroyRoom(r.id);
      return;
    }

    if (remainingCount < 2 && (r.phase === 'playing' || r.phase === 'gameover')) {
      resetToLobby(r);
      return;
    }

    if (r.currentTurn === socket.id) {
      nextTurn(r);
    }

    broadcastState(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Scorched Earth server running on port ${PORT}`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   External: bind 0.0.0.0 (ngrok/배포 OK)`);
});
