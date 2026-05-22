const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// === Auth & DB (Supabase) ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const AUTH_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);
const supabase = AUTH_ENABLED ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }) : null;

if (!AUTH_ENABLED) {
  console.warn('⚠️  SUPABASE_URL / SUPABASE_KEY not set — auth & stats disabled. Game still works as guest-only.');
} else {
  console.log('✅ Supabase connected, auth & stats enabled');
}

function signToken(user) {
  return jwt.sign({ uid: user.id, u: user.username }, JWT_SECRET, { expiresIn: '30d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}
function authError(res, code, msg) { return res.status(code).json({ error: msg }); }

// === Auth routes ===
app.post('/api/auth/register', async (req, res) => {
  if (!AUTH_ENABLED) return authError(res, 503, '인증 서비스가 비활성화되어 있습니다');
  const { username, password } = req.body || {};
  if (!username || !password) return authError(res, 400, '아이디/비밀번호 필요');
  const u = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(u)) return authError(res, 400, '아이디는 영문/숫자/_ 3-16자');
  if (String(password).length < 4) return authError(res, 400, '비밀번호 최소 4자');

  const { data: existing } = await supabase.from('users').select('id').eq('username', u).maybeSingle();
  if (existing) return authError(res, 409, '이미 사용 중인 아이디');

  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ username: u, password_hash: hash })
    .select('id, username, wins, losses, total_games, total_kills, total_damage')
    .single();
  if (error) return authError(res, 500, '가입 실패: ' + error.message);
  const token = signToken(data);
  res.json({ token, user: data });
});

app.post('/api/auth/login', async (req, res) => {
  if (!AUTH_ENABLED) return authError(res, 503, '인증 서비스가 비활성화되어 있습니다');
  const { username, password } = req.body || {};
  if (!username || !password) return authError(res, 400, '아이디/비밀번호 필요');
  const u = String(username).trim().toLowerCase();
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, password_hash, wins, losses, total_games, total_kills, total_damage')
    .eq('username', u).maybeSingle();
  if (error || !user) return authError(res, 401, '아이디/비밀번호 불일치');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return authError(res, 401, '아이디/비밀번호 불일치');
  const token = signToken(user);
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
});

app.get('/api/auth/me', async (req, res) => {
  if (!AUTH_ENABLED) return authError(res, 503, 'disabled');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload) return authError(res, 401, 'invalid token');
  const { data, error } = await supabase
    .from('users')
    .select('id, username, wins, losses, total_games, total_kills, total_damage, created_at')
    .eq('id', payload.uid).maybeSingle();
  if (error || !data) return authError(res, 404, 'user not found');
  res.json({ user: data });
});

app.get('/api/leaderboard', async (req, res) => {
  if (!AUTH_ENABLED) return res.json({ entries: [] });
  const { data, error } = await supabase
    .from('users')
    .select('username, wins, losses, total_games, total_kills, total_damage')
    .order('wins', { ascending: false })
    .order('total_kills', { ascending: false })
    .limit(20);
  if (error) return authError(res, 500, error.message);
  res.json({ entries: data || [] });
});

app.get('/api/stats/:username', async (req, res) => {
  if (!AUTH_ENABLED) return authError(res, 503, 'disabled');
  const u = String(req.params.username || '').trim().toLowerCase();
  const { data, error } = await supabase
    .from('users')
    .select('username, wins, losses, total_games, total_kills, total_damage, created_at')
    .eq('username', u).maybeSingle();
  if (error || !data) return authError(res, 404, 'not found');
  const { data: matches } = await supabase
    .from('matches')
    .select('tank_type, won, kills, damage_dealt, score, played_at')
    .eq('username', u)
    .order('played_at', { ascending: false })
    .limit(20);
  res.json({ user: data, recent: matches || [] });
});

// === Stats persistence helpers ===
async function persistMatchResult(room, winnerId) {
  if (!AUTH_ENABLED) return;
  const inserts = [];
  for (const [pid, p] of Object.entries(room.players)) {
    if (!p.userId) continue; // 게스트는 기록 안 함
    const won = pid === winnerId;
    inserts.push({
      user_id: p.userId,
      username: p.username || p.name,
      room_id: room.id,
      tank_type: p.tankType,
      won,
      kills: p.kills || 0,
      damage_dealt: Math.round(p.damageDealt || 0),
      score: room.scores[pid] || 0,
    });
  }
  if (inserts.length === 0) return;
  try {
    await supabase.from('matches').insert(inserts);
    // 누적 stats 업데이트
    for (const m of inserts) {
      await supabase.rpc('increment_user_stats', {
        p_user_id: m.user_id,
        p_won: m.won,
        p_kills: m.kills,
        p_damage: m.damage_dealt,
      }).catch(async () => {
        // RPC 없으면 fallback: SELECT 후 UPDATE
        const { data: cur } = await supabase.from('users').select('wins, losses, total_games, total_kills, total_damage').eq('id', m.user_id).single();
        if (!cur) return;
        await supabase.from('users').update({
          wins: (cur.wins || 0) + (m.won ? 1 : 0),
          losses: (cur.losses || 0) + (m.won ? 0 : 1),
          total_games: (cur.total_games || 0) + 1,
          total_kills: (cur.total_kills || 0) + m.kills,
          total_damage: (cur.total_damage || 0) + m.damage_dealt,
        }).eq('id', m.user_id);
      });
    }
  } catch (e) {
    console.error('persistMatchResult error', e);
  }
}

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

// === Tank types (6개국 전차) — 능력치 합계 100, 탱크별 NORMAL 포탄 특성 차별 ===
// HP/4 + range×25 + move/8 + speed×25 = 100
// range: 포탄 초기속도 multiplier (사거리에 영향)
// speed: 포탄 속도 추가 multiplier (비행 시간 단축, 운동에너지 증가)
// move: 게임 전체 이동 가능 거리 (px)
// ammo.kind = 'HE'|'HEAT'|'MULTI'|'AP'|'APFSDS'|'FastHE'
//   - radius/damage: 직격 기준
//   - multi: 메인 폭발 후 좌우 추가 sub-폭발 개수 (포트리스 멀티탄)
//   - pierce: APFSDS류 직격 시 운동에너지 추가 배수
const TANK_TYPES = {
  K2:    { id: 'K2',    name: 'K2 흑표',         country: '한국',   flag: '🇰🇷', hp: 100, range: 1.0, move: 200, speed: 1.0, desc: '균형 HE',           ammo: { kind: 'HE',     radius: 35, damage: 35 } },
  M1A2:  { id: 'M1A2',  name: 'M1A2 에이브람스', country: '미국',   flag: '🇺🇸', hp: 140, range: 1.0, move: 120, speed: 1.0, desc: '중장갑 / 큰폭발',   ammo: { kind: 'HEAT',   radius: 48, damage: 36 } },
  ZTZ99: { id: 'ZTZ99', name: 'ZTZ-99',          country: '중국',   flag: '🇨🇳', hp:  80, range: 0.8, move: 280, speed: 1.0, desc: '멀티탄 (3발 분산)', ammo: { kind: 'MULTI',  radius: 26, damage: 24, multi: 3, multiSpread: 1.3, subDamageRatio: 0.55 } },
  T90:   { id: 'T90',   name: 'T-90',            country: '러시아', flag: '🇷🇺', hp: 100, range: 0.8, move: 200, speed: 1.2, desc: '속사 AP',           ammo: { kind: 'AP',     radius: 26, damage: 42 } },
  LEO2:  { id: 'LEO2',  name: 'Leopard 2',       country: '독일',   flag: '🇩🇪', hp: 100, range: 1.4, move: 120, speed: 1.0, desc: '장거리 APFSDS',     ammo: { kind: 'APFSDS', radius: 22, damage: 44, pierce: 1.25 } },
  T10:   { id: 'T10',   name: '10식',            country: '일본',   flag: '🇯🇵', hp:  70, range: 1.0, move: 240, speed: 1.1, desc: '경량 속사 / 정밀',  ammo: { kind: 'FastHE', radius: 30, damage: 34 } },
};
const DEFAULT_TANK = 'K2';
function getTankDef(id) { return TANK_TYPES[id] || TANK_TYPES[DEFAULT_TANK]; }

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
    const tankDef = getTankDef(room.players[id].tankType);
    room.players[id].x = x;
    room.players[id].y = y - TANK_HEIGHT / 2;
    room.players[id].hp = tankDef.hp;
    room.players[id].maxHp = tankDef.hp;
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
    const tankDef = getTankDef(p.tankType);
    p.alive = true;
    p.hp = tankDef.hp;
    p.maxHp = tankDef.hp;
    p.angle = 45;
    p.power = 50;
    p.doubleShots = STARTING_DOUBLE_SHOTS;
    p.doubleShotPending = false;
    p.laserShots = 0;
    p.moveBudget = tankDef.move;
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
    let winnerId = null;
    if (alivePlayers.length === 1) {
      winnerId = alivePlayers[0];
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

    // 전적 기록 (비동기, 결과 기다리지 않음)
    persistMatchResult(room, winnerId).catch(e => console.error('match save error', e));

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

// === Physical scale ===
// 탱크 크기 4m = 30 px → 1 px ≈ 0.133 m, 캔버스 1400 px ≈ 186 m
// 60 fps 가정 → 속도 v(px/frame) × 60 × 0.133 ≈ 실제 m/s
// 운동에너지 KE = 0.5 × m × v², 데미지는 KE에 비례 (m=1 가정)
const SPEED_REF = 15;          // 이 속도(px/frame)일 때 운동에너지 계수 1.0

function applyExplosion(room, x, y, weaponType = 'normal', projectileSpeed = null, shooter = null, isSubExplosion = false) {
  let radius = EXPLOSION_RADIUS;
  let maxDamage = PROJECTILE_DAMAGE;

  if (weaponType === 'redbean') {
    radius = 15;
    maxDamage = 80;
  } else if (weaponType === 'laser_guided') {
    radius = LASER_RADIUS;
    maxDamage = LASER_DAMAGE;
  } else if (weaponType === 'normal' && shooter) {
    // 탱크별 NORMAL 포탄 차별
    const tankDef = getTankDef(shooter.tankType);
    if (tankDef.ammo) {
      radius = tankDef.ammo.radius;
      maxDamage = tankDef.ammo.damage;
      // 멀티탄의 sub-폭발은 약하게
      if (isSubExplosion) {
        radius = radius * 0.78;
        maxDamage = maxDamage * (tankDef.ammo.subDamageRatio || 0.55);
      }
    }
  }

  // 운동에너지 비례 데미지: damage = (v² / v_ref²) × 무기 데미지 × 거리 감쇠
  // 직격 즉사 방지 위해 cap 0.35 ~ 1.5 범위로 제한
  // laser_guided 는 폭격기 무기라 속도 무관 (factor=1.0)
  let speedFactor = 1.0;
  if (projectileSpeed != null && weaponType !== 'laser_guided') {
    const v2 = (projectileSpeed * projectileSpeed) / (SPEED_REF * SPEED_REF);
    speedFactor = Math.max(0.35, Math.min(1.5, v2));
  }
  // APFSDS pierce: 운동에너지 추가 배수 (LEO2)
  if (weaponType === 'normal' && shooter) {
    const tankAmmo = getTankDef(shooter.tankType).ammo;
    if (tankAmmo && tankAmmo.pierce) {
      speedFactor *= tankAmmo.pierce;
    }
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
      const damage = Math.round(maxDamage * speedFactor * (1 - dist / (radius * 1.5)));
      const actualDamage = Math.max(damage, 5);
      player.hp = Math.max(0, player.hp - actualDamage);
      // shooter 통계 추적 (자기 자신 피격은 제외)
      if (shooter && shooter.id !== id) {
        shooter.damageDealt = (shooter.damageDealt || 0) + actualDamage;
      }
      if (player.hp <= 0) {
        player.alive = false;
        if (shooter && shooter.id !== id) {
          shooter.kills = (shooter.kills || 0) + 1;
        }
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

  // 멀티탄 (포트리스 스타일): 메인 폭발 후 좌우 추가 sub-폭발
  if (!isSubExplosion && weaponType === 'normal' && shooter) {
    const tankAmmo = getTankDef(shooter.tankType).ammo;
    if (tankAmmo && tankAmmo.multi && tankAmmo.multi > 1) {
      const baseRadius = tankAmmo.radius;
      const spread = baseRadius * (tankAmmo.multiSpread || 1.3);
      const subCount = tankAmmo.multi - 1;
      for (let i = 0; i < subCount; i++) {
        const sign = i % 2 === 0 ? -1 : 1;
        const step = Math.ceil((i + 1) / 2);
        const sx = x + spread * step * sign;
        // 지형 위치에 맞춰 sub-폭발 y 조정
        const sy = Math.min(y, getTerrainY(room.terrain, sx) - 5);
        applyExplosion(room, sx, sy, weaponType, projectileSpeed, shooter, true);
      }
    }
  }
}

function simulateProjectile(startX, startY, angle, power, shooter) {
  const tankDef = shooter ? getTankDef(shooter.tankType) : getTankDef(DEFAULT_TANK);
  // range × speed = 포탄 초기속도 multiplier (사거리/속도 둘 다 영향)
  const factor = (tankDef.range || 1.0) * (tankDef.speed || 1.0);
  const radians = angle * Math.PI / 180;
  const vx = Math.cos(radians) * power * 0.18 * factor;
  const vy = -Math.sin(radians) * power * 0.18 * factor;

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

  const proj = simulateProjectile(player.x, player.y, player.angle, player.power, player);
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
    // 명중 직전 포탄의 최종 속력 (운동에너지 데미지 계산용)
    const finalSpeed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
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
        applyExplosion(room, px, py, 'laser_guided', null, player);
        if (room.airstrike) room.airstrike.phase = 'bombing';
        broadcastState(room);
      }, AIRSTRIKE_INCOMING_MS);
      setTimeout(() => {
        room.airstrike = null;
        broadcastState(room);
        finishShot();
      }, AIRSTRIKE_INCOMING_MS + AIRSTRIKE_LINGER_MS);
    } else {
      applyExplosion(room, px, py, proj.type, finalSpeed, player);
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
// Socket.IO 인증 미들웨어
io.use((socket, next) => {
  const token = (socket.handshake.auth && socket.handshake.auth.token)
    || (socket.handshake.query && socket.handshake.query.token);
  if (token && AUTH_ENABLED) {
    const payload = verifyToken(token);
    if (payload) {
      socket.data.userId = payload.uid;
      socket.data.username = payload.u;
    }
  }
  next();
});

io.on('connection', (socket) => {
  const rawRoom = socket.handshake.query && socket.handshake.query.room;
  const room = getOrCreateRoom(rawRoom);
  console.log(`Player connected: ${socket.id} → room ${room.id} ${socket.data.username ? `(user: ${socket.data.username})` : '(guest)'}`);

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

  const defaultTankDef = getTankDef(DEFAULT_TANK);
  const initialName = socket.data.username
    ? String(socket.data.username).toUpperCase().substring(0, 12)
    : TANK_NAMES[colorIndex];
  room.players[socket.id] = {
    id: socket.id,
    name: initialName,
    userId: socket.data.userId || null,
    username: socket.data.username || null,
    color: assignedColor,
    tankType: DEFAULT_TANK,
    x: 0,
    y: 0,
    angle: 45,
    power: 50,
    hp: defaultTankDef.hp,
    maxHp: defaultTankDef.hp,
    alive: true,
    moveBudget: defaultTankDef.move,
    doubleShots: STARTING_DOUBLE_SHOTS,
    doubleShotPending: false,
    laserShots: 0,
    kills: 0,
    damageDealt: 0,
  };

  if (!room.scores[socket.id]) {
    room.scores[socket.id] = 0;
  }

  socket.emit('init', { playerId: socket.id, roomId: room.id, tankTypes: TANK_TYPES });
  if (room.chatHistory.length > 0) {
    socket.emit('chatHistory', room.chatHistory);
  }
  broadcastState(room);
  systemChat(room, `${room.players[socket.id].name} 님이 입장했습니다`);

  socket.on('setName', (name) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.players[socket.id]) {
      // 로그인 사용자는 이름 변경 불가 (계정 username 사용)
      if (r.players[socket.id].userId) return;
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
        const tankDef = getTankDef(r.players[id].tankType);
        r.scores[id] = 0;
        r.players[id].doubleShots = STARTING_DOUBLE_SHOTS;
        r.players[id].doubleShotPending = false;
        r.players[id].laserShots = 0;
        r.players[id].moveBudget = tankDef.move;
        r.players[id].kills = 0;
        r.players[id].damageDealt = 0;
      });
      startNewRound(r);
    }
  });

  // 대기방에서만 탱크 종류 변경
  socket.on('setTank', (tankId) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'lobby') return;
    if (!TANK_TYPES[tankId]) return;
    const p = r.players[socket.id];
    if (!p) return;
    p.tankType = tankId;
    const tankDef = getTankDef(tankId);
    p.hp = tankDef.hp;
    p.maxHp = tankDef.hp;
    p.moveBudget = tankDef.move;
    broadcastState(r);
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
