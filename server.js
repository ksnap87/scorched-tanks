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
  // K/D 랭킹 — 서버 측에서 계산 후 정렬 (kills / max(1, losses))
  const { data, error } = await supabase
    .from('users')
    .select('username, wins, losses, total_games, total_kills, total_damage')
    .limit(200);
  if (error) return authError(res, 500, error.message);
  const entries = (data || []).map(u => {
    const losses = u.losses || 0;
    const kills = u.total_kills || 0;
    const games = u.total_games || 0;
    const kd = kills / Math.max(1, losses);
    return { ...u, kd: Number(kd.toFixed(2)) };
  }).filter(e => (e.total_games || 0) >= 1)
    .sort((a, b) => {
      if (b.kd !== a.kd) return b.kd - a.kd;
      if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
      return (b.wins || 0) - (a.wins || 0);
    })
    .slice(0, 20);
  res.json({ entries });
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
  // 연습 게임(1명) 또는 비공식 매치는 전적 기록 안 함
  if (Object.keys(room.players).length < 2) return;
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
const PROJECTILE_DRAG = 0.0008;     // 0.0012 → 0.0008: 비행 중 감속 줄임, 명중 시 v 보존

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
// range: 포탄 사거리 (사용자 지정 사정거리 / 50, 미국=1.0이 지도의 3/4 도달)
// moveSpeed: 탱크 이동속도 (한 번 클릭/키보드 입력당 이동 거리 multiplier)
// move: 게임 전체 누적 이동 가능량 (px)
// speed: 포탄 비행 속도 (운동에너지 영향)
// ammo: NORMAL 일반탄 (radius=폭발범위, damage=파괴력)
// bomb2: REDBEAN 자리 특수탄 (탱크별 다름)
//   - kind: 'redbean'|'multi'|'uranium'|'guided'|'shotgun'
const TANK_TYPES = {
  // 카운터 구도 (가위바위보):
  // K2 → T10/ZTZ99 (빨콩 직격) / 약점: 사거리 짧음 → LEO2/T90 에 약함
  // M1A2 → T90/LEO2 (탱키 + 광역) / 약점: 느림 → T10/K2 의 정확한 직격에 약함
  // T90 → M1A2/K2 (DOT 누적) / 약점: AP 좁음 → 광역(ZTZ/M1A2)에 약함
  // T10 → LEO2/M1A2 (기동 + 유도) / 약점: HP/사거리 → ZTZ99 광역에 약함
  // ZTZ99 → T10/T90 (광역 화염) / 약점: 사거리 최단 → LEO2/K2 의 거리유지에 약함
  // LEO2 → ZTZ99/K2 (사거리/관통) / 약점: HP 최약 → T10/M1A2 의 접근/직격에 약함
  K2:    { id: 'K2',    name: 'K2 흑표',         country: '한국',   flag: '🇰🇷',
           hp: 125, range: 0.85, move: 150, speed: 1.0, moveSpeed: 2.0,
           desc: '단발 직격형 · 빨콩 65',
           ammo:  { kind: 'HE',     radius: 11, damage: 32 },
           bomb2: { kind: 'redbean', name: '빨콩',  damage: 65, radius: 8,  range: 1.3 },
           ultimate: { kind: 'army_missile',    name: '한화 유도탄',   damage: 78, radius: 12, terrainRadius: 18 } },
  M1A2:  { id: 'M1A2',  name: 'M1A2 에이브람스', country: '미국',   flag: '🇺🇸',
           hp: 140, range: 1.0, move: 95, speed: 1.0, moveSpeed: 1.4,
           desc: '탱키 (HP 140) · 멀티/카펫 · 느림',
           ammo:  { kind: 'HE',     radius: 12, damage: 30 },
           bomb2: { kind: 'multi',   name: '멀티탄 ×4', damage: 13, radius: 4, range: 1.0, multi: 4, multiSpreadPx: 28, subDamageRatio: 0.85 },
           ultimate: { kind: 'b2_carpet',       name: 'B-2 스피릿',    damage: 40, radius: 42, terrainRadius: 16 } },
  T90:   { id: 'T90',   name: 'T-90',            country: '러시아', flag: '🇷🇺',
           hp: 128, range: 1.2, move: 130, speed: 1.0, moveSpeed: 1.3,
           desc: 'AP 관통 · 우라늄 광역 지속딜',
           ammo:  { kind: 'AP',     radius: 6,  damage: 36, pierce: 1.20 },
           bomb2: { kind: 'uranium', name: '우라늄탄', damage: 15, radius: 12, range: 1.2, dotRadius: 28, dotDps: 3, dotDuration: 9 },
           ultimate: { kind: 'drone_grenade',   name: '드론 수류탄',   damage: 38, radius: 8,  terrainRadius: 10 } },
  T10:   { id: 'T10',   name: '10식',            country: '일본',   flag: '🇯🇵',
           hp: 110, range: 0.65, move: 175, speed: 1.0, moveSpeed: 2.4,
           desc: '닌자 (기동 175/2.4) · 정밀 유도',
           ammo:  { kind: 'HE',     radius: 10, damage: 29 },
           bomb2: { kind: 'guided', name: '정밀 유도탄', damage: 38, radius: 14, range: 0.95, guideMs: 5000 },
           ultimate: { kind: 'kamikaze',        name: '카미카제',      damage: 58, radius: 24, terrainRadius: 22 } },
  ZTZ99: { id: 'ZTZ99', name: 'ZTZ-99',          country: '중국',   flag: '🇨🇳',
           hp: 118, range: 0.55, move: 125, speed: 1.0, moveSpeed: 1.4,
           desc: '광역 화염 · 위성 레이저',
           ammo:  { kind: 'HE',     radius: 15, damage: 28 },
           bomb2: { kind: 'shotgun', name: '화염탄', damage: 18, radius: 30, range: 0.8, airBurst: 50, fire: { radius: 42, dps: 2.5, duration: 8 } },
           ultimate: { kind: 'satellite_laser', name: '위성 레이저',   damage: 70, radius: 5,  terrainRadius: 28 } },
  LEO2:  { id: 'LEO2',  name: 'Leopard 2',       country: '독일',   flag: '🇩🇪',
           hp: 88, range: 1.5, move: 115, speed: 1.0, moveSpeed: 1.0,
           desc: '저격수 (사거리 1.5×) · HP 최약',
           ammo:  { kind: 'APFSDS', radius: 16, damage: 36, pierce: 1.20 },
           bomb2: { kind: 'laser_beam', name: '레이저', damage: 34, range: 250, beamWidth: 8, terrainDig: 12 },
           ultimate: { kind: 'stuka_dive',       name: 'Stuka 급강하',  damage: 44, radius: 15, terrainRadius: 15 } },
};
const DEFAULT_TANK = 'K2';
function getTankDef(id) { return TANK_TYPES[id] || TANK_TYPES[DEFAULT_TANK]; }

// === 대륙 + 자연재해 ===
const TANK_TO_CONTINENT = { K2: 'KR', M1A2: 'US', ZTZ99: 'CN', T90: 'RU', LEO2: 'DE', T10: 'JP' };
const CONTINENT_INFO = {
  KR: { name: '한반도', flag: '🇰🇷', weatherPreferred: 'typhoon',   skyTop: '#1a2a3a', skyBot: '#3a4a5a' },
  US: { name: '북미',   flag: '🇺🇸', weatherPreferred: 'random',    skyTop: '#0d1d3a', skyBot: '#2a1535' },
  CN: { name: '고비사막', flag: '🇨🇳', weatherPreferred: 'sandstorm', skyTop: '#6a4a1f', skyBot: '#b08740' },
  RU: { name: '시베리아', flag: '🇷🇺', weatherPreferred: 'snow',     skyTop: '#2c3850', skyBot: '#5e6b80' },
  JP: { name: '일본 열도', flag: '🇯🇵', weatherPreferred: 'rain',     skyTop: '#1a2030', skyBot: '#3a4a5a' },
  DE: { name: '유럽 평원', flag: '🇩🇪', weatherPreferred: 'random',    skyTop: '#0d1030', skyBot: '#2a1535' },
};
const WEATHER_KINDS = ['rain', 'snow', 'typhoon', 'sandstorm'];

function pickContinent(room) {
  const hostId = room.host;
  if (hostId && room.players[hostId]) {
    return TANK_TO_CONTINENT[room.players[hostId].tankType] || 'KR';
  }
  return 'KR';
}

function pickWeatherKind(continent) {
  const info = CONTINENT_INFO[continent];
  if (info && info.weatherPreferred && info.weatherPreferred !== 'random') return info.weatherPreferred;
  return WEATHER_KINDS[Math.floor(Math.random() * WEATHER_KINDS.length)];
}

const WEATHER_NAMES = {
  rain: '🌧 폭우',
  snow: '❄️ 폭설',
  typhoon: '🌪 태풍',
  sandstorm: '🟡 모래바람',
};

function applyWeatherImmediate(room) {
  const w = room.weather;
  if (!w) return;
  switch (w.kind) {
    case 'typhoon': {
      // 모든 탱크 랜덤 ±20px (요청 명세)
      const mw = room.mapWidth || CANVAS_WIDTH;
      Object.values(room.players).forEach(p => {
        if (!p.alive) return;
        const dx = (Math.random() - 0.5) * 40;
        let nx = p.x + dx;
        if (nx < 0) nx += mw;
        else if (nx >= mw) nx -= mw;
        p.x = nx;
        p.y = getTerrainY(room.terrain, p.x) - TANK_HEIGHT / 2;
      });
      break;
    }
    case 'snow':
      // 모든 탱크 -5 HP (러시아 T-90 면역)
      Object.values(room.players).forEach(p => {
        if (!p.alive) return;
        if (p.tankType === 'T90') return;
        p.hp = Math.max(0, p.hp - 5);
        if (p.hp <= 0) p.alive = false;
      });
      break;
    case 'rain':   /* 이동 차단 / 늪지대는 move 핸들러에서 처리 */ break;
    case 'sandstorm': /* 시야 효과는 클라이언트 */ break;
  }
}

function maybeTriggerWeather(room) {
  if (room.phase !== 'playing') return;
  if (room.weather) return;
  if (room.weatherUsedThisGame) return;
  if ((room.turnsTotal || 0) < 5) return;
  const kind = pickWeatherKind(room.continent);
  room.weather = { kind, startedAt: Date.now(), turnsLeft: 2 };
  room.weatherUsedThisGame = true;
  applyWeatherImmediate(room);
  systemChat(room, `${WEATHER_NAMES[kind] || kind} 발동!`);
  if (WEATHER_DESC[kind]) {
    setTimeout(() => systemChat(room, WEATHER_DESC[kind]), 400);
  }
}

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

// === Cooldown (장전속도) — 데미지와 반비례 (강한 무기일수록 길게) ===
function getCooldownMs(player, weaponType) {
  const tankDef = getTankDef(player.tankType);
  let baseCd = 2000;
  let dmg = 30;
  if (weaponType === 'normal') {
    baseCd = 1800;
    dmg = (tankDef.ammo && tankDef.ammo.damage) || 30;
  } else if (weaponType === 'redbean') {
    baseCd = 2800;
    dmg = (tankDef.bomb2 && tankDef.bomb2.damage) || 30;
  } else if (weaponType === 'laser_guided') {
    baseCd = 5000;
    dmg = (tankDef.ultimate && tankDef.ultimate.damage) || 60;
  } else if (weaponType === 'nuke') {
    baseCd = 8000;
    dmg = 200;
  }
  let cd = baseCd + dmg * 60;
  if (player.siegeMode === 'sieged') cd *= 0.8;       // 시즈모드 +20% (cd -20%)
  return cd;
}

// === Teams ===
function assignTeams(room) {
  const ids = Object.keys(room.players);
  // 입장 순서대로 A, B 번갈아
  ids.forEach((id, i) => {
    room.players[id].team = i % 2 === 0 ? 'A' : 'B';
  });
}

// 팀전 — 한 팀 전원 사망 시 게임 종료
function checkTeamGameEnd(room) {
  if (!room.teamMode || room.phase !== 'playing') return;
  const aliveA = Object.values(room.players).filter(p => p.team === 'A' && p.alive).length;
  const aliveB = Object.values(room.players).filter(p => p.team === 'B' && p.alive).length;
  if (aliveA > 0 && aliveB > 0) return;
  // 한 팀 전원 사망
  const winningTeam = aliveA > 0 ? 'A' : (aliveB > 0 ? 'B' : null);
  // 승리 팀 player에 점수 +100
  if (winningTeam) {
    Object.values(room.players).forEach(p => {
      if (p.team === winningTeam) {
        if (!room.scores[p.id]) room.scores[p.id] = 0;
        room.scores[p.id] += 100;
      }
    });
  }
  if (room.itemSpawnTimer) { clearTimeout(room.itemSpawnTimer); room.itemSpawnTimer = null; }
  room.itemBoxes = [];
  room.airstrike = null;
  room.phase = 'gameover';
  broadcastState(room);
  persistMatchResult(room, null).catch(e => console.error('match save error', e));
  if (room.lobbyReturnTimer) clearTimeout(room.lobbyReturnTimer);
  room.gameoverEndsAt = Date.now() + 5000;
  io.to(room.id).emit('gameoverInfo', { endsAt: room.gameoverEndsAt, winningTeam });
  room.lobbyReturnTimer = setTimeout(() => resetToLobby(room), 5000);
}

function createRoom(id) {
  return {
    id,
    host: null,
    phase: 'lobby',
    teamMode: false,
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
    turnTimeLeft: 20,
    itemBoxes: [],
    itemSpawnTimer: null,
    airstrike: null,
    nextItemBoxId: 1,
    chatHistory: [],
    lobbyReturnTimer: null,
    radiationZones: [],   // 우라늄탄 오염 지역 [{x, y, radius, dps, endsAt, shooterId}]
    nextZoneId: 1,
    continent: 'KR',
    weather: null,         // { kind, startedAt, turnsLeft, ... }
    turnsTotal: 0,         // 자연재해 발동 트리거용
    weatherUsedThisGame: false, // 게임당 한 번만
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

// === 9가지 맵 타입 (전술 다양성) ===
const MAP_TYPES = ['flat', 'peak', 'valley', 'twin_peaks', 'island', 'plateau', 'staircase', 'floating_islands', 'pit'];
const MAP_DESC = {
  flat: '🌾 평지 — 사거리 우위 (LEO2 유리)',
  peak: '⛰ 중앙 봉우리 — 고지대 점령 + 낙하데미지 (T10 기동 유리)',
  valley: '🏞 가운데 협곡 — 사선 사격 + 폭탄 굴러내림 (ZTZ99 광역 유리)',
  twin_peaks: '⛰⛰ 이중 봉우리 — 양 사이드 진지전 (T90 사거리 유리)',
  island: '🏝 섬 — 양옆 절벽 + 가운데 봉우리 (M1A2 카펫/탱키 유리)',
  plateau: '🪨 고원 — 중앙 평평한 평지 + 좌우 비탈 (K2 빨콩 직격 유리)',
  staircase: '📐 계단 — 점진 상승 지형 (각도 계산 중요)',
  floating_islands: '🌫 떠있는 섬 — 3개 분리된 platform + 깊은 골 (떨어지면 큰 낙하 데미지)',
  pit: '🕳 함정 — 가운데 깊은 구덩이 (밑에서 폭탄으로 땅 파괴 → 추락 사망 가능)',
};
let lastMapType = null;  // 같은 맵 연속 방지

function generateTerrain(continent = 'KR', mapWidth = CANVAS_WIDTH) {
  const terrain = [];
  const points = [];
  const numPoints = mapWidth > CANVAS_WIDTH * 1.5 ? 14 : 10;

  // 대륙별 기본 (y 중심, 변화량) — 탱크가 화면 중하단에 위치하도록 yBase 키움
  let yBase = 0.60, yRange = 0.16;
  switch (continent) {
    case 'RU': yBase = 0.62; yRange = 0.12; break;
    case 'CN': yBase = 0.58; yRange = 0.18; break;
    case 'KR': yBase = 0.60; yRange = 0.16; break;
    case 'JP': yBase = 0.62; yRange = 0.16; break;
    case 'US': yBase = 0.58; yRange = 0.18; break;
    case 'DE': yBase = 0.62; yRange = 0.12; break;
  }

  // 맵 타입 랜덤 (이전 맵 제외)
  const available = MAP_TYPES.filter(m => m !== lastMapType);
  const mapType = available[Math.floor(Math.random() * available.length)];
  lastMapType = mapType;

  const H = CANVAS_HEIGHT;
  for (let i = 0; i <= numPoints; i++) {
    const x = (i / numPoints) * mapWidth;
    const tPos = i / numPoints;            // 0..1 가로 위치
    const centerDist = Math.abs(tPos - 0.5) * 2;  // 0(center) .. 1(edge)
    const noise = (Math.random() - 0.5) * yRange * H * 0.5;
    let y = H * yBase + noise;
    switch (mapType) {
      case 'flat':
        y = H * 0.65 + (Math.random() - 0.5) * H * 0.04;
        break;
      case 'peak':
        // 중앙 봉우리 — 너무 높지 않게
        y -= (1 - centerDist) * H * 0.18;
        break;
      case 'valley':
        // 중앙 협곡
        y += (1 - centerDist) * H * 0.15;
        break;
      case 'twin_peaks': {
        // 양 사이드 봉우리 (tPos = 0.25, 0.75)
        const peakDist = Math.min(Math.abs(tPos - 0.25), Math.abs(tPos - 0.75));
        y -= Math.max(0, (1 - peakDist * 3)) * H * 0.18;
        break;
      }
      case 'island':
        // 가운데 봉우리 + 양 끝 절벽
        if (centerDist < 0.4) y -= (1 - centerDist / 0.4) * H * 0.16;
        else if (centerDist > 0.7) y += (centerDist - 0.7) / 0.3 * H * 0.20;
        break;
      case 'plateau':
        // 중앙 평평한 고원 + 좌우 비탈
        if (centerDist < 0.35) y -= H * 0.12;
        else y -= (1 - (centerDist - 0.35) / 0.65) * H * 0.06;
        break;
      case 'staircase':
        // 점진 상승 (왼→오) 또는 (오→왼)
        {
          const direction = (Math.sin(Date.now() / 7919) > 0) ? 1 : -1;
          y -= (direction > 0 ? tPos : (1 - tPos)) * H * 0.18;
        }
        break;
      case 'floating_islands': {
        // 3개 platform: 양옆 + 가운데. 사이는 깊은 골 (단 controls 영역 위까지만)
        const centers = [0.15, 0.5, 0.85];
        let dMin = Infinity;
        centers.forEach(c => { const d = Math.abs(tPos - c); if (d < dMin) dMin = d; });
        if (dMin < 0.08) {
          y = H * 0.55 + (Math.random() - 0.5) * H * 0.03;
        } else {
          y = H * 0.74 + (Math.random() - 0.5) * H * 0.03;
        }
        break;
      }
      case 'pit': {
        if (centerDist < 0.25) {
          y = H * 0.76 + (Math.random() - 0.5) * H * 0.04;
        } else {
          y -= centerDist * H * 0.05;
        }
        break;
      }
    }
    points.push({ x, y });
  }

  for (let x = 0; x < mapWidth; x += TERRAIN_RESOLUTION) {
    const t = x / mapWidth;
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
    // y 최대 한계 — 컨트롤 패널 (하단 ~120px) 영역에 탱크가 들어가지 않게
    terrain.push(Math.max(H * 0.18, Math.min(H * 0.78, y)));
  }

  // 맵 타입 metadata 를 마지막 element 로 attach (room 에서 추출용)
  terrain._mapType = mapType;
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

  const mw = room.mapWidth || CANVAS_WIDTH;
  const margin = 60;
  const spacing = (mw - margin * 2) / (numPlayers + 1);

  const slots = [];
  for (let i = 0; i < numPlayers; i++) slots.push(margin + spacing * (i + 1));

  // 팀전: 3가지 배치 패턴 중 랜덤 (번갈아 / 동서분리 / 역 동서분리). 가끔 몰림 OK.
  // 일반: 완전 셔플.
  let orderedIds;
  if (room.teamMode) {
    const teamA = playerIds.filter(id => room.players[id].team === 'A');
    const teamB = playerIds.filter(id => room.players[id].team === 'B');
    const noTeam = playerIds.filter(id => !room.players[id].team);
    const pattern = Math.floor(Math.random() * 3);  // 0=interleave, 1=A서-B동, 2=B서-A동
    if (pattern === 0) {
      // 번갈아: A B A B A B
      orderedIds = [];
      const maxLen = Math.max(teamA.length, teamB.length);
      for (let i = 0; i < maxLen; i++) {
        if (teamA[i]) orderedIds.push(teamA[i]);
        if (teamB[i]) orderedIds.push(teamB[i]);
      }
    } else if (pattern === 1) {
      // A 서쪽, B 동쪽
      orderedIds = [...teamA, ...teamB];
    } else {
      // B 서쪽, A 동쪽
      orderedIds = [...teamB, ...teamA];
    }
    orderedIds.push(...noTeam);
  } else {
    orderedIds = playerIds.slice();
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }

  orderedIds.forEach((id, i) => {
    // 팀전: 흔들림 없이 슬롯 그대로 (랜덤하지 않게). 일반: 살짝 흔들림.
    const jitter = room.teamMode
      ? 0
      : (Math.random() - 0.5) * Math.min(spacing * 0.5, 80);
    let trialX = Math.max(margin, Math.min(mw - margin, slots[i] + jitter));
    // 가파른 언덕 회피 — 슬롯 근처에서만 미세 조정 (팀전 순서 유지)
    const maxNudge = room.teamMode ? Math.min(spacing * 0.35, 40) : 60;
    for (let tryN = 0; tryN < 10; tryN++) {
      const yL = getTerrainY(room.terrain, Math.max(0, trialX - 18));
      const yR = getTerrainY(room.terrain, Math.min(mw - 1, trialX + 18));
      const tiltAbs = Math.abs(Math.atan2(yR - yL, 36));
      if (tiltAbs < 0.45) break; // 약 26도 미만이면 OK
      // 슬롯 중심에서 너무 멀어지지 않게 (인접 슬롯 침범 방지)
      const delta = (Math.random() - 0.5) * 24;
      const candidate = trialX + delta;
      if (Math.abs(candidate - slots[i]) <= maxNudge) trialX = candidate;
      trialX = Math.max(margin, Math.min(mw - margin, trialX));
    }
    const x = trialX;
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
    room.players[id].siegeMode = 'idle';
    room.players[id].siegeChangedAt = 0;
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
  room.turnTimeLeft = 20;

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
    p.repairKits = 0;
    p.moveBudget = tankDef.move;
  });

  broadcastState(room);
}

// 대륙별 특징 설명 (게임 시작 시 채팅에 표시)
const CONTINENT_DESC = {
  KR: '🇰🇷 한반도 — 산악 지형이 많고 5턴 이후 🌪 태풍 발생 가능 (탱크 ±20px 이동)',
  US: '🇺🇸 북미 — 평탄한 지형. 랜덤 날씨 발동 가능',
  CN: '🇨🇳 고비사막 — 평탄한 사막 지형. 🟡 모래바람 시 시야 차단됨',
  RU: '🇷🇺 시베리아 — 완만한 지형. ❄️ 폭설 시 모든 탱크 -5 HP (T-90 면역)',
  JP: '🇯🇵 일본 열도 — 중앙 산악. 🌧 폭우 시 이동 제한 + 늪지대 발생',
  DE: '🇩🇪 유럽 평원 — 평탄한 지형. 랜덤 날씨 발동 가능',
};
const WEATHER_DESC = {
  rain: '🌧 폭우 — 이동 불가, 늪지대(저지대) 진입 시 이동속도 50%',
  snow: '❄️ 폭설 — 이동 불가. 시작 시 모든 탱크 -5 HP (T-90 면역)',
  typhoon: '🌪 태풍 — 모든 탱크가 ±20px 랜덤 위치로 이동',
  sandstorm: '🟡 모래바람 — 시야 240px 밖 완전 차단',
};

function startNewRound(room) {
  room.continent = pickContinent(room);
  room.weather = null;
  room.weatherUsedThisGame = false;
  // 팀전이면 맵 2배
  room.mapWidth = room.teamMode ? CANVAS_WIDTH * 2 : CANVAS_WIDTH;
  room.terrain = generateTerrain(room.continent, room.mapWidth);
  room.mapType = room.terrain._mapType || 'flat';
  // 대륙 + 맵 특징 채팅 안내
  if (CONTINENT_DESC[room.continent]) {
    setTimeout(() => systemChat(room, CONTINENT_DESC[room.continent]), 500);
  }
  if (MAP_DESC[room.mapType]) {
    setTimeout(() => systemChat(room, MAP_DESC[room.mapType]), 900);
  }
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
  const mw = room.mapWidth || CANVAS_WIDTH;
  // 박스 타입 — 8턴 이전엔 laser/repair만, 8턴 이후 nuke 일정 확률로 등장
  const turnsPassed = room.turnsTotal || 0;
  const r = Math.random();
  let type;
  if (turnsPassed >= 8 && r >= 0.85) type = 'nuke';        // 15% (8턴 이후만)
  else if (r < 0.55) type = 'laser';
  else type = 'repair';

  // 타입별 위치 결정 — 공중 박스는 지형이 낮은 곳(평지/계곡) 위에 떨어지도록 5번까지 재시도
  let x, targetY;
  if (type === 'repair') {
    // 지면 안착 — 아무 x 면 됨
    x = 220 + Math.random() * (mw - 440);
    const groundY = getTerrainY(room.terrain, x);
    targetY = groundY - 14;
  } else {
    // 공중 — 지형 표면보다 최소 80px 위, 화면 상단 30px 아래
    let bestY = 110, bestX = 220 + Math.random() * (mw - 440);
    for (let attempt = 0; attempt < 5; attempt++) {
      const tryX = 220 + Math.random() * (mw - 440);
      const groundY = getTerrainY(room.terrain, tryX);
      const maxY = groundY - 80;        // 지형 위 80px 이상 띄움
      if (maxY > 80) {
        // 평지 위 — 60 ~ min(maxY, 230) 사이 random
        bestX = tryX;
        bestY = 60 + Math.random() * Math.max(20, Math.min(170, maxY - 60));
        break;
      }
      // 봉우리에 가까운 위치면 다음 시도
    }
    x = bestX;
    targetY = bestY;
  }
  room.itemBoxes.push({
    id: room.nextItemBoxId++,
    x,
    y: targetY,                  // 최종 안착 y
    targetY,                     // 클라 애니메이션용
    type,
    wobblePhase: Math.random() * Math.PI * 2,
    spawnedAt: Date.now(),       // 클라가 비행기 떨어뜨리는 애니메이션 시작점
    dropFromY: -40,              // 시작 y (하늘 위, 비행기 고도)
  });
  broadcastState(room);
  room.itemSpawnTimer = setTimeout(() => spawnItemBox(room), ITEM_BOX_RESPAWN);
}

function resetTurnTimer(room) {
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnTimeLeft = 20;
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
  // 팀전(실시간) 모드는 turn 시스템 사용 X — 즉시 return
  if (room.teamMode) {
    checkTeamGameEnd(room);
    return;
  }
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

  room.turnsTotal = (room.turnsTotal || 0) + 1;

  // 자연재해 — 매 턴마다 지속시간 감소, 0이면 종료
  if (room.weather) {
    room.weather.turnsLeft = (room.weather.turnsLeft || 0) - 1;
    if (room.weather.turnsLeft <= 0) {
      systemChat(room, `${WEATHER_NAMES[room.weather.kind] || ''} 종료`);
      room.weather = null;
    } else {
      // 매 턴 polish (snow는 추가 데미지, typhoon은 한 번만)
      if (room.weather.kind === 'snow') applyWeatherImmediate(room);
    }
  }
  // 트리거 체크
  maybeTriggerWeather(room);

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
  let terrainRadius = null; // 명시 안 하면 radius 사용

  if (weaponType === 'nuke') {
    // 핵폭탄 — 광역 파괴
    radius = 200;
    maxDamage = 200;
    terrainRadius = 200;
  } else if (weaponType === 'redbean') {
    // REDBEAN 자리 = 탱크별 bomb2
    if (shooter) {
      const tankDef = getTankDef(shooter.tankType);
      if (tankDef.bomb2) {
        radius = tankDef.bomb2.radius;
        maxDamage = tankDef.bomb2.damage;
        terrainRadius = radius;
        // sub-explosion (멀티탄 4발 같은)이면 약하게
        if (isSubExplosion) {
          radius = radius * 0.85;
          maxDamage = maxDamage * (tankDef.bomb2.subDamageRatio || 0.8);
        }
      } else {
        radius = 15; maxDamage = 80;
      }
    } else {
      radius = 15; maxDamage = 80;
    }
  } else if (weaponType === 'laser_guided') {
    // 탱크별 ULTIMATE 차별
    if (shooter) {
      const tankDef = getTankDef(shooter.tankType);
      if (tankDef.ultimate) {
        radius = tankDef.ultimate.radius;
        maxDamage = tankDef.ultimate.damage;
        terrainRadius = tankDef.ultimate.terrainRadius;
      } else {
        radius = LASER_RADIUS;
        maxDamage = LASER_DAMAGE;
      }
    } else {
      radius = LASER_RADIUS;
      maxDamage = LASER_DAMAGE;
    }
  } else if (weaponType === 'normal' && shooter) {
    // 탱크별 NORMAL 포탄 차별
    const tankDef = getTankDef(shooter.tankType);
    if (tankDef.ammo) {
      radius = tankDef.ammo.radius;
      maxDamage = tankDef.ammo.damage;
      // 일반탄 땅 파는 효과 20% 증가
      terrainRadius = radius * 1.2;
      // 멀티탄의 sub-폭발은 약하게
      if (isSubExplosion) {
        radius = radius * 0.78;
        maxDamage = maxDamage * (tankDef.ammo.subDamageRatio || 0.55);
        terrainRadius = radius * 1.2;
      }
    }
  }

  // 운동에너지 비례 데미지: damage = (v² / v_ref²) × 무기 데미지 × 거리 감쇠
  // min 1.0 — 속도 감속과 무관하게 항상 base damage 보장 (운동에너지는 위쪽으로만 보너스)
  let speedFactor = 1.0;
  if (projectileSpeed != null && weaponType !== 'laser_guided') {
    const v2 = (projectileSpeed * projectileSpeed) / (SPEED_REF * SPEED_REF);
    speedFactor = Math.max(1.0, Math.min(1.5, v2));
  }
  // APFSDS pierce: 운동에너지 추가 배수 (LEO2)
  if (weaponType === 'normal' && shooter) {
    const tankAmmo = getTankDef(shooter.tankType).ammo;
    if (tankAmmo && tankAmmo.pierce) {
      speedFactor *= tankAmmo.pierce;
    }
  }

  // 지형 파괴는 별도 반경 (terrainRadius)으로 — 데미지 반경과 분리
  const tRadius = terrainRadius != null ? terrainRadius : radius;
  for (let i = 0; i < room.terrain.length; i++) {
    const tx = i * TERRAIN_RESOLUTION;
    const dx = tx - x;
    if (Math.abs(dx) < tRadius) {
      const dy = Math.sqrt(tRadius * tRadius - dx * dx);
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
      // 자해 = 상대 데미지 동일 (사용자 정책: 잘못 쏘면 똑같이 피 닳음)
      const siegeMul = (shooter && shooter.siegeMode === 'sieged') ? 1.20 : 1.0;
      const damage = Math.round(maxDamage * speedFactor * (1 - dist / (radius * 1.5)) * siegeMul);
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

    // 자해 허용 — 본인 폭탄으로 인한 낙하 데미지도 적용
    const fallDistance = newY - oldY;

    if (fallDistance > 5) {
      // 낙하 데미지: 기본 선형 + 40px 초과분 가산 (높이가 클수록 가속적으로 증가)
      const base = fallDistance * 0.9;
      const extra = Math.max(0, fallDistance - 40) * 0.8;
      const fallDamage = Math.round(base + extra);
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

  // 화염 종류 — 탱크별 NORMAL 포탄(weaponType === 'normal') 마다 다른 효과
  // redbean/laser_guided/nuke 는 별도 처리
  let flameKind = 'default';
  if (weaponType === 'normal' && shooter) {
    flameKind = `n_${shooter.tankType}`;        // n_K2, n_M1A2, n_T90, n_T10, n_ZTZ99, n_LEO2
  } else if (weaponType === 'redbean' && shooter) {
    const td = getTankDef(shooter.tankType);
    flameKind = `b_${(td.bomb2 && td.bomb2.kind) || 'redbean'}`;   // b_uranium, b_multi, b_shotgun, b_guided, b_redbean
  } else if (weaponType === 'laser_guided') {
    flameKind = 'ult';
  } else if (weaponType === 'nuke') {
    flameKind = 'nuke';
  }
  room.explosions.push({
    id: (room.nextExplosionId = (room.nextExplosionId || 0) + 1),
    x, y, radius, time: Date.now(),
    flameKind,
    sub: !!isSubExplosion,
  });

  // 팀전 — 한 팀 전원 사망 체크 (즉시)
  if (!isSubExplosion && room.teamMode) checkTeamGameEnd(room);

  // bomb2 폭발 후 DOT 지역 생성 (우라늄 = 방사능, 화염탄 = 불) — 자해 허용 (본인 근처에도 생성)
  if (!isSubExplosion && weaponType === 'redbean' && shooter) {
    const tankDef = getTankDef(shooter.tankType);
    if (tankDef.bomb2 && tankDef.bomb2.kind === 'uranium') {
      if (!room.radiationZones) room.radiationZones = [];
      room.radiationZones.push({
        id: room.nextZoneId++,
        x, y,
        radius: tankDef.bomb2.dotRadius || 10,
        dps: tankDef.bomb2.dotDps || 1,
        startedAt: Date.now(),
        endsAt: Date.now() + (tankDef.bomb2.dotDuration || 8) * 1000,
        shooterId: shooter.id,
        dotKind: 'uranium',
      });
    } else if (tankDef.bomb2 && tankDef.bomb2.fire) {
      // 화염탄 (중국 ZTZ-99) — 폭발 후 불 지역 생성
      if (!room.radiationZones) room.radiationZones = [];
      const fireY = getTerrainY(room.terrain, x);  // 불은 지형 위에
      room.radiationZones.push({
        id: room.nextZoneId++,
        x, y: fireY,
        radius: tankDef.bomb2.fire.radius,
        dps: tankDef.bomb2.fire.dps,
        startedAt: Date.now(),
        endsAt: Date.now() + tankDef.bomb2.fire.duration * 1000,
        shooterId: shooter.id,
        dotKind: 'fire',
      });
    }
  }

  // 멀티탄 (포트리스 스타일): NORMAL ammo + bomb2 둘 다 multi 옵션 지원
  if (!isSubExplosion && shooter) {
    const tankDef = getTankDef(shooter.tankType);
    let multiSpec = null;
    if (weaponType === 'normal' && tankDef.ammo && tankDef.ammo.multi > 1) {
      multiSpec = tankDef.ammo;
    } else if (weaponType === 'redbean' && tankDef.bomb2 && tankDef.bomb2.multi > 1) {
      multiSpec = tankDef.bomb2;
    }
    if (multiSpec) {
      const spread = multiSpec.multiSpreadPx
        ? multiSpec.multiSpreadPx
        : (multiSpec.radius * (multiSpec.multiSpread || 1.3));
      const subCount = multiSpec.multi - 1;
      // 떨어지는 지점 기준 앞/뒤로 분산 (x축 방향)
      for (let i = 0; i < subCount; i++) {
        const sign = i % 2 === 0 ? -1 : 1;
        const step = Math.ceil((i + 1) / 2);
        const sx = x + spread * step * sign;
        const sy = Math.min(y, getTerrainY(room.terrain, sx) - 5);
        applyExplosion(room, sx, sy, weaponType, projectileSpeed, shooter, true);
      }
    }
  }
}

// Leopard 2 — 직선 레이저 빔 발사. 지형 관통 (땅 깎임) + 닿는 모든 탱크에 damage.
function fireLaserBeam(room, shooter, bomb2Spec) {
  const mw = room.mapWidth || CANVAS_WIDTH;
  // 발사 시점의 탱크 기울기 (effective angle) — 클라 포신 회전과 일치 (부호: angle - tiltDeg)
  let tiltDeg = 0;
  if (room.terrain && shooter.siegeMode !== 'sieged') {
    const yL = getTerrainY(room.terrain, shooter.x - 16);
    const yR = getTerrainY(room.terrain, shooter.x + 16);
    const tr = Math.atan2(yR - yL, 32);
    if (Number.isFinite(tr)) tiltDeg = Math.max(-40, Math.min(40, tr * 180 / Math.PI));
  }
  const effAngle = (shooter.angle || 90) - tiltDeg;
  const rad = effAngle * Math.PI / 180;
  // 시작점 (포구) — 포신 끝
  const barrelLen = (BARREL_LEN_BY_TANK[shooter.tankType] || 22) * 1.0;
  const turretY = shooter.y - 4;
  const startX = shooter.x + Math.cos(rad) * barrelLen;
  const startY = turretY - Math.sin(rad) * barrelLen;
  // 방향 단위벡터 (server: 0=오른쪽, 90=위 → dx=cos, dy=-sin)
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const range = bomb2Spec.range || 290;
  const damage = bomb2Spec.damage || 50;
  const beamWidth = bomb2Spec.beamWidth || 8;
  const terrainDig = bomb2Spec.terrainDig || 18;
  // 빔 따라 스텝 진행 (4px 간격)
  const STEP = 4;
  let endX = startX, endY = startY;
  const hitPlayerIds = new Set();
  for (let dist = 0; dist <= range; dist += STEP) {
    const px = startX + dx * dist;
    const py = startY + dy * dist;
    // 맵 wrap
    let pxw = px;
    if (pxw < 0) pxw += mw;
    else if (pxw >= mw) pxw -= mw;
    endX = pxw;
    endY = py;
    // 지형 깎기 (관통) — terrain[idx] += terrainDig (y 가 커지면 지형이 내려가는 = 파괴)
    const idx = Math.floor(pxw / TERRAIN_RESOLUTION);
    if (idx >= 0 && idx < room.terrain.length) {
      // 빔 굵기 만큼 좌우 인덱스도 깎음
      const halfIdx = Math.ceil((beamWidth / 2) / TERRAIN_RESOLUTION);
      for (let k = -halfIdx; k <= halfIdx; k++) {
        const j = idx + k;
        if (j >= 0 && j < room.terrain.length) {
          // 빔이 지형 안에 있어야 깎음 (y >= terrain[j] 일 때만)
          if (py >= room.terrain[j] - beamWidth / 2) {
            room.terrain[j] = Math.min(CANVAS_HEIGHT - 5, room.terrain[j] + terrainDig * 0.18);
          }
        }
      }
    }
    // 탱크 hit (이미 hit 한 적은 제외 — 빔이 관통하면서 같은 탱크 여러 번 hit 방지)
    for (const id of Object.keys(room.players)) {
      const target = room.players[id];
      if (!target.alive) continue;
      if (hitPlayerIds.has(id)) continue;
      const tdx = target.x - pxw;
      const tdy = target.y - py;
      const sq = tdx * tdx + tdy * tdy;
      const hitR = (beamWidth / 2) + 16;
      if (sq < hitR * hitR) {
        hitPlayerIds.add(id);
        const before = target.hp;
        target.hp = Math.max(0, target.hp - damage);
        if (shooter && shooter.id !== id) {
          shooter.damageDealt = (shooter.damageDealt || 0) + (before - target.hp);
        }
        if (target.hp <= 0) {
          target.alive = false;
          if (shooter && shooter.id !== id) {
            shooter.kills = (shooter.kills || 0) + 1;
            if (!room.scores[shooter.id]) room.scores[shooter.id] = 0;
            room.scores[shooter.id] += 50;
          }
        }
      }
    }
  }
  // 빔 시각 이펙트 (클라가 그릴 정보) — 250ms 표시
  if (!room.laserBeams) room.laserBeams = [];
  room.laserBeams.push({
    id: (room.nextLaserBeamId = (room.nextLaserBeamId || 0) + 1),
    x1: startX, y1: startY, x2: endX, y2: endY,
    width: beamWidth,
    color: '#7BD3FF',
    startedAt: Date.now(),
    duration: 280,
  });
  // 만료 cleanup
  setTimeout(() => {
    if (room.laserBeams) {
      room.laserBeams = room.laserBeams.filter(b => Date.now() - b.startedAt < b.duration);
      broadcastState(room);
    }
  }, 320);
  if (room.teamMode) checkTeamGameEnd(room);
  broadcastState(room);
}

// 탱크별 포신 길이 (drawTanks의 barrel과 일치)
const BARREL_LEN_BY_TANK = { K2: 26, M1A2: 24, T90: 22, LEO2: 28, T10: 20, ZTZ99: 22 };

function simulateProjectile(startX, startY, angle, power, shooter, room) {
  const tankDef = shooter ? getTankDef(shooter.tankType) : getTankDef(DEFAULT_TANK);
  const factor = (tankDef.range || 1.0) * (tankDef.speed || 1.0);

  // 지형 기울기 — 클라 포신과 동일한 방향으로 발사 (시즈모드는 수평 고정)
  // 클라: ctx.rotate(tiltRad) 시계방향 좌표계 안에서 player.angle 로 포신 그림.
  //   회전된 좌표계의 "위"는 월드 기준 오른쪽 위 (sin(tilt), -cos(tilt)).
  // 서버 convention: 0=오른쪽, 90=위. 이 방향을 server angle 로 환산하면 angle=90-tiltDeg.
  //   따라서 일반화: effAngle = userAngle - tiltDeg.
  let tiltDeg = 0;
  if (room && room.terrain && (!shooter || shooter.siegeMode !== 'sieged')) {
    const yL = getTerrainY(room.terrain, startX - 16);
    const yR = getTerrainY(room.terrain, startX + 16);
    const tiltRad = Math.atan2(yR - yL, 32);
    if (Number.isFinite(tiltRad)) {
      tiltDeg = Math.max(-40, Math.min(40, tiltRad * 180 / Math.PI));
    }
  }
  const effAngle = angle - tiltDeg;
  const radians = effAngle * Math.PI / 180;

  // 포신 끝(머즐)에서 발사 — 탱크 포탑 중심 (startY - 4) 기준
  const turretY = startY - 4;
  const barrelLen = BARREL_LEN_BY_TANK[shooter ? shooter.tankType : null] || 22;
  const muzzleX = startX + Math.cos(radians) * barrelLen;
  const muzzleY = turretY - Math.sin(radians) * barrelLen;
  const vx = Math.cos(radians) * power * 0.18 * factor;
  const vy = -Math.sin(radians) * power * 0.18 * factor;

  return { x: muzzleX, y: muzzleY, vx, vy };
}

function startFire(room, player, weaponType, useDouble) {
  if (!player) return false;
  if (room.phase !== 'playing') return false;
  // 팀전: currentTurn 무시 (실시간) + cooldown 체크
  if (room.teamMode) {
    if (Date.now() < (player.cooldownUntil || 0)) return false;
    // 팀전에서 동시 발사 — projectile 1개 제한 풀고 player별로 (단순화 위해 일단 1개)
    if (room.projectile) return false;
    // 시즈모드 변환 중엔 발사 X
    if (player.siegeMode === 'transforming' || player.siegeMode === 'untransforming') return false;
  } else {
    if (room.currentTurn !== player.id) return false;
    if (room.projectile) return false;
  }
  if (!player.alive) return false;

  if (weaponType === 'laser_guided' || weaponType === 'nuke') useDouble = false;

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
  if (actualWeapon === 'nuke') {
    if ((player.nukeShots ?? 0) <= 0) return false;
    player.nukeShots--;
  }

  // 멀티탄(미국 bomb2): 메인 발사 후 추가 발사 큐
  let multiQueueRemaining = 0;
  let multiAngleOffsets = [];
  if (actualWeapon === 'redbean') {
    const tankDef = getTankDef(player.tankType);
    if (tankDef.bomb2 && tankDef.bomb2.kind === 'multi' && tankDef.bomb2.multi > 1) {
      multiQueueRemaining = tankDef.bomb2.multi - 1;
      // 각도 약간씩 분산 (-6, +6, -3, +3 등)
      const spreadDeg = 7;
      for (let i = 1; i <= multiQueueRemaining; i++) {
        const s = i % 2 === 0 ? 1 : -1;
        const step = Math.ceil(i / 2);
        multiAngleOffsets.push(s * step * spreadDeg);
      }
    }
  }

  // === Leopard 2 레이저 빔 (bomb2.kind === 'laser_beam') ===
  // 일직선으로 발사, 지형 관통 (땅 깎임), 닿는 모든 탱크 데미지. simulateProjectile 안 거침.
  if (actualWeapon === 'redbean') {
    const tankDef = getTankDef(player.tankType);
    if (tankDef.bomb2 && tankDef.bomb2.kind === 'laser_beam') {
      fireLaserBeam(room, player, tankDef.bomb2);
      // 발사 직후 종료 처리
      if (isFirstOfDouble) {
        setTimeout(() => {
          if (room.phase !== 'playing') return;
          if (!room.teamMode && room.currentTurn !== player.id) return;
          if (!player.alive) {
            player.doubleShotPending = false;
            if (!room.teamMode) nextTurn(room);
            return;
          }
          const ok = startFire(room, player, weaponType, false);
          if (!ok) {
            player.doubleShotPending = false;
            if (!room.teamMode) setTimeout(() => nextTurn(room), 800);
          }
        }, 700);
      } else {
        if (player.doubleShotPending) player.doubleShotPending = false;
        if (room.teamMode) {
          player.cooldownUntil = Date.now() + getCooldownMs(player, actualWeapon);
          checkTeamGameEnd(room);
        } else {
          setTimeout(() => nextTurn(room), 1000);
        }
      }
      return true;
    }
  }

  const proj = simulateProjectile(player.x, player.y, player.angle, player.power, player, room);
  proj.type = actualWeapon;
  proj.shooterId = player.id;
  proj.tickCount = 0;     // 발사 후 tick. 5 tick(≈80ms) 이후엔 자기 hit 가능 (저파워 자해 보장)
  // ZTZ-99 샷건탄 — airBurst 거리 설정
  if (actualWeapon === 'redbean') {
    const tankDef = getTankDef(player.tankType);
    if (tankDef.bomb2 && tankDef.bomb2.kind === 'shotgun' && tankDef.bomb2.airBurst) {
      proj.airBurstDist = tankDef.bomb2.airBurst;
    }
  }
  proj.isMultiPrimary = multiQueueRemaining > 0;
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
        // 팀전: currentTurn 무관, alive 면 두 번째 발사
        if (room.teamMode) {
          if (!player.alive) {
            player.doubleShotPending = false;
            return;
          }
          const ok = startFire(room, player, weaponType, false);
          if (!ok) {
            player.doubleShotPending = false;
            player.cooldownUntil = Date.now() + getCooldownMs(player, actualWeapon);   // stuck 방지
          }
          return;
        }
        // 일반전 (턴제)
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
      // 팀전(실시간): cooldown만 적용, turn 진행 X
      if (room.teamMode) {
        player.cooldownUntil = Date.now() + getCooldownMs(player, actualWeapon);
        checkTeamGameEnd(room);
      } else {
        setTimeout(() => nextTurn(room), 1000);
      }
    }
  };

  const detonate = (px, py) => {
    // 명중 직전 포탄의 최종 속력 (운동에너지 데미지 계산용)
    const finalSpeed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
    if (proj.type === 'laser_guided') {
      const shooterTankDef = getTankDef(player.tankType);
      const ult = shooterTankDef.ultimate || { kind: 'default' };

      // 실제 폭발 좌표 — 카미카제는 도중 지형 충돌 시 그 지점
      let detonateX = px;
      let detonateY = py;
      if (ult.kind === 'kamikaze') {
        const mw = room.mapWidth || CANVAS_WIDTH;
        const fromLeft = px < mw / 2;
        const startX = fromLeft ? -60 : mw + 60;
        const startY = 40;
        const steps = 120;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const cx = startX + (px - startX) * t;
          const cy = startY + (py - startY) * (t * t); // 가속 곡선 (drawKamikaze와 동일)
          if (cx < 0 || cx > mw) continue;
          const tY = getTerrainY(room.terrain, cx);
          if (cy >= tY) {
            detonateX = cx;
            detonateY = tY;
            break;
          }
        }
      }

      room.airstrike = {
        targetX: detonateX,
        targetY: detonateY,
        originalTargetX: px,
        originalTargetY: py,
        originX: player.x,
        originY: player.y,
        startTime: Date.now(),
        incomingMs: AIRSTRIKE_INCOMING_MS,
        lingerMs: AIRSTRIKE_LINGER_MS,
        phase: 'incoming',
        kind: ult.kind,
        tankType: player.tankType,
        tankFlag: shooterTankDef.flag,
        ultName: ult.name,
      };
      broadcastState(room);

      // === B-2 카펫 폭격: 시각이랑 정확히 일치하도록 8발 분산 ===
      // 클라 drawB2Spirit 의 jetXAt 와 동일 공식 사용. 폭탄 i 는 (incoming - 1000 + i*dropInterval) 시점에 jetXAt 위치에서 자유낙하.
      // 자유낙하 시간 약 1500ms 의 가속 곡선 끝점이 a.targetY → 폭탄 i 의 폭발 X = jetXAt(myDropStart)
      const isCarpet = ult.kind === 'b2_carpet' || ult.kind === 'f22_carpet';
      if (isCarpet) {
        // === B-2 순차 투하 — 8발 좌우 살짝 분산 + 시간차로 각자 폭발 ===
        const bombCount = 8;
        const incoming = AIRSTRIKE_INCOMING_MS;
        // 클라 drawB2Spirit 와 동일한 타이밍 + spread
        const dropWindowStart = incoming - 1000;
        const dropWindowEnd = incoming + 100;
        const dropInterval = (dropWindowEnd - dropWindowStart) / (bombCount - 1);
        const fallMs = 800;
        const SPREAD_PX = 14;                  // 폭탄 X 간격 (±49px 분산)
        const subDamage = Math.max(8, Math.round(ult.damage * 0.28));
        const subRadius = Math.max(10, Math.round(ult.radius * 0.4));
        const mw = room.mapWidth || CANVAS_WIDTH;
        for (let i = 0; i < bombCount; i++) {
          const myDropStart = dropWindowStart + i * dropInterval;
          // 폭탄 X (클라와 정확히 일치하는 식)
          let bombX = detonateX + (i - 3.5) * SPREAD_PX;
          // 맵 wrap
          if (bombX < 0) bombX += mw;
          else if (bombX >= mw) bombX -= mw;
          const bx = bombX;
          const bombTerrainY = getTerrainY(room.terrain, bx);
          // 시각상 폭탄이 지면에 닿는 시점 = myDropStart + fallMs
          const fireAtMs = Math.max(50, Math.min(AIRSTRIKE_INCOMING_MS + AIRSTRIKE_LINGER_MS - 100, myDropStart + fallMs));
          setTimeout(() => {
            if (room.phase !== 'playing') return;
            const td = getTankDef(player.tankType);
            const origDmg = td.ultimate.damage;
            const origRad = td.ultimate.radius;
            const origTR = td.ultimate.terrainRadius;
            td.ultimate.damage = subDamage;
            td.ultimate.radius = subRadius;
            td.ultimate.terrainRadius = Math.max(8, Math.round((origTR || subRadius) * 0.55));
            applyExplosion(room, bx, bombTerrainY, 'laser_guided', null, player);
            td.ultimate.damage = origDmg;
            td.ultimate.radius = origRad;
            td.ultimate.terrainRadius = origTR;
            // 폭발 즉시 broadcast — 클라가 폭발/지형변화를 바로 받음
            broadcastState(room);
          }, fireAtMs);
        }
        setTimeout(() => {
          if (room.airstrike) room.airstrike.phase = 'bombing';
          broadcastState(room);
        }, AIRSTRIKE_INCOMING_MS);
      } else {
        // 단발 폭발 (다른 ult — kamikaze/army/drone/satellite/stuka)
        setTimeout(() => {
          applyExplosion(room, detonateX, detonateY, 'laser_guided', null, player);
          if (room.airstrike) room.airstrike.phase = 'bombing';
          broadcastState(room);
        }, AIRSTRIKE_INCOMING_MS);
      }
      setTimeout(() => {
        room.airstrike = null;
        broadcastState(room);
        finishShot();
      }, AIRSTRIKE_INCOMING_MS + AIRSTRIKE_LINGER_MS);
    } else if (proj.type === 'nuke') {
      // 핵폭탄 — 버섯구름 시각 1.5초 → 폭발 + 큰 데미지 + 광역 지형 파괴
      const NUKE_MUSHROOM_MS = 1500;
      const groundY = getTerrainY(room.terrain, px);
      room.nukeEffect = {
        id: (room.nextNukeId = (room.nextNukeId || 0) + 1),
        x: px,
        y: groundY,
        startedAt: Date.now(),
        duration: NUKE_MUSHROOM_MS,
        phase: 'mushroom',
      };
      broadcastState(room);
      setTimeout(() => {
        if (room.phase !== 'playing') { finishShot(); return; }
        // 실제 폭발 (NUKE) — 데미지 + 지형 파괴
        applyExplosion(room, px, groundY, 'nuke', finalSpeed, player);
        if (room.nukeEffect) room.nukeEffect.phase = 'explode';
        broadcastState(room);
        // 폭발 잔여 시각 1초
        setTimeout(() => {
          room.nukeEffect = null;
          broadcastState(room);
          finishShot();
        }, 1000);
      }, NUKE_MUSHROOM_MS);
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

    // 좌우 wrap (랩어라운드)
    const _mw = room.mapWidth || CANVAS_WIDTH;
    if (p.x < 0) p.x += _mw;
    else if (p.x >= _mw) p.x -= _mw;

    const px = p.x;
    const py = p.y;
    p.tickCount = (p.tickCount || 0) + 1;

    // 아래로만 종료 (좌우는 wrap)
    if (py > CANVAS_HEIGHT + 50) {
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
        if (shooter) {
          if (box.type === 'laser') {
            shooter.laserShots = (shooter.laserShots ?? 0) + 1;
          } else if (box.type === 'repair') {
            shooter.repairKits = (shooter.repairKits ?? 0) + 1;
          } else if (box.type === 'nuke') {
            shooter.nukeShots = (shooter.nukeShots ?? 0) + 1;
          }
          io.to(room.id).emit('itemPickup', { playerId: shooter.id, playerName: shooter.name, type: box.type });
        }
        room.explosions.push({ id: (room.nextExplosionId = (room.nextExplosionId || 0) + 1), x: box.x, y: box.y, radius: 24, time: Date.now(), kind: 'box', flameKind: 'pickup' });
        room.projectile = null;
        clearInterval(simInterval);
        broadcastState(room);
        finishShot();
        return;
      }
    }

    const terrainY = getTerrainY(room.terrain, px);

    // ZTZ-99 샷건탄 — 지형 도달 전에 공중 폭발 (airBurst px 위에서)
    // 발사자에서 어느 정도 떨어진 후에만 활성 (자기 머리 위 즉발 방지)
    if (p.type === 'redbean' && p.airBurstDist) {
      const shooterPlayer = room.players[p.shooterId];
      const distFromShooter = shooterPlayer
        ? Math.sqrt((px - shooterPlayer.x) ** 2 + (py - shooterPlayer.y) ** 2)
        : 999;
      const armed = distFromShooter > p.airBurstDist * 2;
      if (armed && terrainY - py < p.airBurstDist) {
        room.projectile = null;
        clearInterval(simInterval);
        detonate(px, py);
        return;
      }
    }

    if (py >= terrainY) {
      room.projectile = null;
      clearInterval(simInterval);
      detonate(px, terrainY);
      return;
    }

    // ZTZ-99 샷건탄: 탱크 접근 시 공중 폭발 (탱크 위 airBurst px에서 터짐)
    // 발사자에서 충분히 떨어진 후만 활성
    if (p.type === 'redbean' && p.airBurstDist) {
      const shooterPlayer = room.players[p.shooterId];
      const distFromShooter = shooterPlayer
        ? Math.sqrt((px - shooterPlayer.x) ** 2 + (py - shooterPlayer.y) ** 2)
        : 999;
      if (distFromShooter > p.airBurstDist * 2) {
        for (const id of Object.keys(room.players)) {
          const target = room.players[id];
          if (!target.alive) continue;
          // 본인은 포구 거리(40px) 이전엔 즉발 방지, 그 이후는 자해 허용
          if (target.id === p.shooterId && p.tickCount < 5) continue;   // 발사 직후만 즉발 방지, 5 tick 후엔 자해 hit
          const dx = target.x - px;
          const dy = target.y - py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < p.airBurstDist) {
            room.projectile = null;
            clearInterval(simInterval);
            detonate(px, py);
            return;
          }
        }
      }
    }

    for (const id of Object.keys(room.players)) {
      const target = room.players[id];
      if (!target.alive) continue;
      // 자해 허용 — 발사 직후 5 tick만 즉발 방지, 그 후엔 자기 포탄에 hit
      if (target.id === p.shooterId && p.tickCount < 5) continue;
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

// 탱크 이동 시 지면 박스 (REPAIR) 픽업 체크
function checkPlayerGroundPickup(room, player) {
  if (!room.itemBoxes || room.itemBoxes.length === 0) return;
  for (let i = room.itemBoxes.length - 1; i >= 0; i--) {
    const box = room.itemBoxes[i];
    if (box.type !== 'repair') continue;   // 지면 박스만 (laser/nuke 는 공중, 발사체로 픽업)
    const dx = player.x - box.x;
    const dy = player.y - box.y;
    if (Math.sqrt(dx * dx + dy * dy) < 32) {
      room.itemBoxes.splice(i, 1);
      player.repairKits = (player.repairKits ?? 0) + 1;
      io.to(room.id).emit('itemPickup', { playerId: player.id, playerName: player.name, type: 'repair' });
      room.explosions.push({ id: (room.nextExplosionId = (room.nextExplosionId || 0) + 1), x: box.x, y: box.y, radius: 22, time: Date.now(), kind: 'box', flameKind: 'pickup' });
      systemChat(room, `🔧 ${player.name} 수리키트 획득 (총 ${player.repairKits}개)`);
    }
  }
}

function ensureHost(room) {
  const ids = Object.keys(room.players);
  if (ids.length === 0) { room.host = null; return; }
  // host가 빈 값이거나 실제 player로 없으면 첫 사람에게 자동 인계
  if (!room.host || !room.players[room.host]) {
    room.host = ids[0];
  }
}

// === 우라늄 DOT tick (매초) ===
setInterval(() => {
  const now = Date.now();
  Object.values(rooms).forEach(room => {
    if (room.phase !== 'playing') return;
    if (!room.radiationZones || room.radiationZones.length === 0) return;
    // 만료된 zone 제거
    const before = room.radiationZones.length;
    room.radiationZones = room.radiationZones.filter(z => z.endsAt > now);
    let changed = before !== room.radiationZones.length;
    // 각 zone 안의 살아있는 탱크에게 DOT 데미지
    const mwDot = room.mapWidth || CANVAS_WIDTH;
    room.radiationZones.forEach(z => {
      // 우라늄 — 클라 시각의 흘러내림 범위와 동일하게 데미지 적용 (양옆 baseSpread 까지)
      if (z.dotKind === 'uranium') {
        const elapsed = now - (z.startedAt || now);
        const baseSpread = Math.min(z.radius * 8, z.radius * 2 + (elapsed / 1000) * z.radius * 1.5);
        const leftTY = getTerrainY(room.terrain, Math.max(0, z.x - 60));
        const rightTY = getTerrainY(room.terrain, Math.min(mwDot - 1, z.x + 60));
        const centerTY = getTerrainY(room.terrain, z.x);
        const leftFlow = leftTY > centerTY ? 1.6 : (leftTY < centerTY ? 0.4 : 1.0);
        const rightFlow = rightTY > centerTY ? 1.6 : (rightTY < centerTY ? 0.4 : 1.0);
        const minX = z.x - baseSpread * leftFlow;
        const maxX = z.x + baseSpread * rightFlow;
        Object.values(room.players).forEach(p => {
          if (!p.alive) return;
          if (p.x < minX || p.x > maxX) return;
          // 탱크가 지면 근처에 있어야 (지표면 따라 흐름)
          const groundY = getTerrainY(room.terrain, p.x);
          if (Math.abs(p.y - groundY) > 40) return;
          // 중심에서 멀수록 데미지 약하게. 본인 zone 도 동일 데미지 (자해 동일 정책)
          const distNorm = Math.abs(p.x - z.x) / Math.max(1, baseSpread * Math.max(leftFlow, rightFlow));
          const intensity = Math.max(0.35, 1 - distNorm * 0.7);
          const dmg = z.dps * intensity;
          p.hp = Math.max(0, p.hp - dmg);
          changed = true;
          p.radiationHitAt = now;
          const shooter = room.players[z.shooterId];
          if (shooter && shooter.id !== p.id) {
            shooter.damageDealt = (shooter.damageDealt || 0) + dmg;
          }
          if (p.hp <= 0) {
            p.alive = false;
            if (shooter && shooter.id !== p.id) {
              shooter.kills = (shooter.kills || 0) + 1;
              if (room.scores[shooter.id] == null) room.scores[shooter.id] = 0;
              room.scores[shooter.id] += 50;
            }
          }
        });
      } else {
        // 화염 등 — 원형 범위
        Object.values(room.players).forEach(p => {
          if (!p.alive) return;
          const dx = p.x - z.x;
          const dy = p.y - z.y;
          if (Math.sqrt(dx * dx + dy * dy) < z.radius) {
            const fireDmg = z.dps;     // 자해 동일 데미지
            p.hp = Math.max(0, p.hp - fireDmg);
            changed = true;
            p.radiationHitAt = now;
            const shooter = room.players[z.shooterId];
            if (shooter && shooter.id !== p.id) {
              shooter.damageDealt = (shooter.damageDealt || 0) + z.dps;
            }
            if (p.hp <= 0) {
              p.alive = false;
              if (shooter && shooter.id !== p.id) {
                shooter.kills = (shooter.kills || 0) + 1;
                if (room.scores[shooter.id] == null) room.scores[shooter.id] = 0;
                room.scores[shooter.id] += 50;
              }
            }
          }
        });
      }
    });
    if (changed) broadcastState(room);
  });
}, 1000);

function broadcastState(room) {
  ensureHost(room);
  // 오래된 explosions 정리 (메모리 누적 방지)
  if (room.explosions && room.explosions.length > 0) {
    const cutoff = Date.now() - 3000;
    room.explosions = room.explosions.filter(e => e.time > cutoff);
  }
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
    radiationZones: room.radiationZones || [],
    continent: room.continent || 'KR',
    weather: room.weather,
    turnsTotal: room.turnsTotal || 0,
    teamMode: !!room.teamMode,
    mapWidth: room.mapWidth || CANVAS_WIDTH,
    laserBeams: room.laserBeams || [],
    nukeEffect: room.nukeEffect || null,
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
    repairKits: 0,
    nukeShots: 0,
    kills: 0,
    damageDealt: 0,
    team: null,                 // 팀전 시 'A' | 'B'
    cooldownUntil: 0,           // 발사 가능 시각 (ms)
    siegeMode: 'idle',          // 'idle' | 'transforming' | 'sieged' | 'untransforming'
    siegeChangedAt: 0,
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
      // 로그인 사용자도 표시 이름 변경 가능 (계정 username 은 별도 보존)
      const cleaned = String(name || '').substring(0, 12).trim();
      if (!cleaned) return;
      const oldName = r.players[socket.id].name;
      r.players[socket.id].name = cleaned;
      broadcastState(r);
      if (oldName !== cleaned) systemChat(r, `${oldName} → ${cleaned}`);
    }
  });

  // 본인 팀 선택 (대기방에서만, 최대 5명 제한)
  socket.on('setTeam', (team) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (!r.teamMode) return;
    if (r.phase !== 'lobby') return;
    if (team !== 'A' && team !== 'B') return;
    const player = r.players[socket.id];
    if (!player) return;
    const teamCount = Object.values(r.players).filter(p => p.team === team).length;
    if (teamCount >= 5 && player.team !== team) {
      io.to(socket.id).emit('teamFull', { team });
      return;
    }
    player.team = team;
    broadcastState(r);
  });

  // 호스트가 팀전 모드 토글 (대기방에서만)
  socket.on('setTeamMode', (enabled) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (socket.id !== r.host) return;
    if (r.phase !== 'lobby') return;
    r.teamMode = !!enabled;
    if (r.teamMode) assignTeams(r);
    else Object.values(r.players).forEach(p => { p.team = null; });
    broadcastState(r);
  });

  // 시즈모드 토글 (팀전 + 실시간 모드 전용)
  socket.on('toggleSiege', () => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    if (!r.teamMode) return;
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    const now = Date.now();
    if (player.siegeMode === 'idle') {
      player.siegeMode = 'transforming';
      player.siegeChangedAt = now;
      setTimeout(() => {
        if (player.siegeMode === 'transforming') {
          player.siegeMode = 'sieged';
          if (player.power < 50) player.power = 50;
          broadcastState(r);
        }
      }, 4000);
    } else if (player.siegeMode === 'sieged') {
      player.siegeMode = 'untransforming';
      player.siegeChangedAt = now;
      setTimeout(() => {
        if (player.siegeMode === 'untransforming') {
          player.siegeMode = 'idle';
          broadcastState(r);
        }
      }, 4000);
    }
    broadcastState(r);
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
        r.players[id].repairKits = 0;
        r.players[id].nukeShots = 0;
        r.players[id].moveBudget = tankDef.move;
        r.players[id].kills = 0;
        r.players[id].damageDealt = 0;
        r.players[id].siegeMode = 'idle';
        r.players[id].siegeChangedAt = 0;
        r.players[id].cooldownUntil = 0;
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

  // 키보드/버튼 1회 이동 (5px × moveSpeed)
  socket.on('move', (direction) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    // 팀전: currentTurn 무시 (실시간), 시즈모드 시 이동 X
    if (r.teamMode) {
      const p0 = r.players[socket.id];
      if (p0 && p0.siegeMode !== 'idle') return;
    } else {
      if (r.currentTurn !== socket.id) return;
      if (r.projectile) return;
    }
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    if (player.moveBudget <= 0) return;

    // 자연재해 — 폭우/폭설 시 이동 불가
    if (r.weather && (r.weather.kind === 'rain' || r.weather.kind === 'snow')) {
      return;
    }
    const tankDef = getTankDef(player.tankType);
    let moveSpeedMul = tankDef.moveSpeed || 1.0;
    // 늪지대 (rain 시 저지대) — 이동 50% 감소  (rain은 이미 위에서 차단됐지만 안전망)
    if (r.weather && r.weather.kind === 'rain') {
      const ty = getTerrainY(r.terrain, player.x);
      if (ty > CANVAS_HEIGHT * 0.55) moveSpeedMul *= 0.5;
    }
    const dir = direction < 0 ? -1 : 1;
    const desiredStep = Math.min(5 * moveSpeedMul, player.moveBudget);
    let newX = player.x + dir * desiredStep;
    // 랩어라운드 — 좌우 끝 연결
    const mw = r.mapWidth || CANVAS_WIDTH;
    if (newX < 0) newX += mw;
    else if (newX >= mw) newX -= mw;
    const actualStep = desiredStep;
    if (actualStep === 0) return;

    player.x = newX;
    player.y = getTerrainY(r.terrain, newX) - TANK_HEIGHT / 2;
    // 소수점 누적 방지 — 정수로 라운드
    player.moveBudget = Math.max(0, Math.round(player.moveBudget - actualStep));
    // 지면 박스 (REPAIR) 픽업 체크
    checkPlayerGroundPickup(r, player);

    broadcastState(r);
  });

  // 거리 지정 이동 (숫자 입력 N × moveSpeed)
  socket.on('moveBy', (data) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    if (r.teamMode) {
      const p0 = r.players[socket.id];
      if (p0 && p0.siegeMode !== 'idle') return;
    } else {
      if (r.currentTurn !== socket.id) return;
      if (r.projectile) return;
    }
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    if (player.moveBudget <= 0) return;

    const tankDef = getTankDef(player.tankType);
    const moveSpeedMul = tankDef.moveSpeed || 1.0;
    const direction = (data && data.direction) || 0;
    let requestedDist = parseInt(data && data.distance);
    if (!Number.isFinite(requestedDist) || requestedDist <= 0) return;
    requestedDist = Math.max(1, Math.min(MOVE_RANGE_PER_TURN, requestedDist)) * moveSpeedMul;

    const dir = direction < 0 ? -1 : 1;
    const desiredStep = Math.min(requestedDist, player.moveBudget);
    let newX = player.x + dir * desiredStep;
    const mw = r.mapWidth || CANVAS_WIDTH;
    if (newX < 0) newX += mw;
    else if (newX >= mw) newX -= mw;
    const actualStep = desiredStep;
    if (actualStep === 0) return;

    player.x = newX;
    player.y = getTerrainY(r.terrain, newX) - TANK_HEIGHT / 2;
    // 소수점 누적 방지 — 정수로 라운드
    player.moveBudget = Math.max(0, Math.round(player.moveBudget - actualStep));
    // 지면 박스 (REPAIR) 픽업 체크
    checkPlayerGroundPickup(r, player);

    broadcastState(r);
  });

  socket.on('setAngle', (angle) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    const p = r.players[socket.id];
    if (!p || !p.alive) return;
    // 팀전: 본인 alive면 항상 OK. 일반전: 본인 턴일 때만.
    if (!r.teamMode && r.currentTurn !== socket.id) return;
    const v = parseInt(angle);
    if (!Number.isFinite(v)) return;
    p.angle = Math.max(0, Math.min(180, v));
    broadcastState(r);
  });

  socket.on('setPower', (power) => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    const p = r.players[socket.id];
    if (!p || !p.alive) return;
    if (!r.teamMode && r.currentTurn !== socket.id) return;
    const v = parseInt(power);
    if (!Number.isFinite(v)) return;
    p.power = Math.max(5, Math.min(150, v));
    // 시즈 모드 시 power 최소 50
    if (p.siegeMode === 'sieged' && p.power < 50) p.power = 50;
    broadcastState(r);
  });

  // 수리 (HP 20% 회복)
  socket.on('repair', () => {
    const r = rooms[socket.data.roomId];
    if (!r) return;
    if (r.phase !== 'playing') return;
    const player = r.players[socket.id];
    if (!player || !player.alive) return;
    // 팀전: 본인 발사 cooldown 중 아니면 OK. 일반전: 본인 턴.
    if (r.teamMode) {
      if (Date.now() < (player.cooldownUntil || 0)) return;
    } else {
      if (r.currentTurn !== socket.id) return;
      if (r.projectile || r.airstrike) return;
    }
    if ((player.repairKits || 0) <= 0) return;
    const heal = Math.round((player.maxHp || 100) * 0.2);
    player.hp = Math.min(player.maxHp || 100, player.hp + heal);
    player.repairKits = (player.repairKits || 0) - 1;
    systemChat(r, `🔧 ${player.name} 수리 +${heal} HP`);
    broadcastState(r);
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
// 한 사용자/한 게임의 에러로 server process 가 죽지 않도록 안전망
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Scorched Earth server running on port ${PORT}`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   External: bind 0.0.0.0 (ngrok/배포 OK)`);
});
