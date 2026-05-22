// === Headless bot simulator ===
// 6개 봇이 각자 다른 탱크로 30판 경기 → 결과 통계 → 어느 탱크가 강한지 측정
// server.js 의 핵심 함수를 require 하지 않고, 게임 물리만 동일 공식으로 재현 (NORMAL 위주 단순 시뮬)
//
// 측정 항목:
// - 탱크별 승률
// - 평균 데미지 in/out
// - 평균 생존 턴
//
// 사용: node sim/botSim.js [matches=30]

const MATCHES = parseInt(process.argv[2]) || 30;
const fs = require('fs');
const path = require('path');

// === TANK_TYPES 복사 (server.js 와 동기화) ===
const TANK_TYPES = {
  K2:    { id: 'K2',    flag: '🇰🇷', hp: 120, range: 0.8, move: 150, moveSpeed: 2.0,
           ammo: { damage: 32, radius: 11 },
           bomb2: { kind: 'redbean', damage: 55, radius: 6, range: 1.3 },
           ultimate: { kind: 'army_missile', damage: 75, radius: 12, terrainRadius: 18 } },
  M1A2:  { id: 'M1A2',  flag: '🇺🇸', hp: 140, range: 1.0, move: 100, moveSpeed: 1.5,
           ammo: { damage: 34, radius: 13 },
           bomb2: { kind: 'multi', damage: 12, radius: 4, multi: 4, multiSpreadPx: 28 },
           ultimate: { kind: 'b2_carpet', damage: 44, radius: 45, terrainRadius: 18 } },
  T90:   { id: 'T90',   flag: '🇷🇺', hp: 130, range: 1.2, move: 130, moveSpeed: 1.3,
           ammo: { damage: 34, radius: 5, pierce: 1.15 },
           bomb2: { kind: 'uranium', damage: 12, radius: 10, dotRadius: 24, dotDps: 2.5, dotDuration: 8 },
           ultimate: { kind: 'drone_grenade', damage: 35, radius: 8, terrainRadius: 10 } },
  T10:   { id: 'T10',   flag: '🇯🇵', hp: 115, range: 0.7, move: 170, moveSpeed: 2.3,
           ammo: { damage: 27, radius: 9 },
           bomb2: { kind: 'guided', damage: 30, radius: 12, range: 0.9 },
           ultimate: { kind: 'kamikaze', damage: 50, radius: 22, terrainRadius: 22 } },
  ZTZ99: { id: 'ZTZ99', flag: '🇨🇳', hp: 115, range: 0.6, move: 120, moveSpeed: 1.3,
           ammo: { damage: 30, radius: 15 },
           bomb2: { kind: 'shotgun', damage: 18, radius: 28, fire: { radius: 40, dps: 2, duration: 8 } },
           ultimate: { kind: 'satellite_laser', damage: 70, radius: 5, terrainRadius: 28 } },
  LEO2:  { id: 'LEO2',  flag: '🇩🇪', hp: 95, range: 1.4, move: 120, moveSpeed: 1.0,
           ammo: { damage: 38, radius: 18, pierce: 1.20 },
           bomb2: { kind: 'laser_beam', damage: 36, range: 260, beamWidth: 8 },
           ultimate: { kind: 'stuka_dive', damage: 45, radius: 15, terrainRadius: 15 } },
};

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 700;
const GRAVITY = 0.15;
const PROJECTILE_DRAG = 0.0012;
const WIND_FACTOR = 0.32;
const SPEED_REF = 15;

// === 지형 생성 (단순 Catmull-Rom) ===
function generateTerrain() {
  const points = [];
  const numPoints = 8;
  for (let i = 0; i <= numPoints; i++) {
    const x = (i / numPoints) * CANVAS_WIDTH;
    const y = CANVAS_HEIGHT * 0.45 + Math.random() * CANVAS_HEIGHT * 0.28;
    points.push({ x, y });
  }
  const terrain = [];
  for (let x = 0; x < CANVAS_WIDTH; x += 2) {
    const t = x / CANVAS_WIDTH;
    const idx = Math.floor(t * numPoints);
    const lt = (t * numPoints) - idx;
    const p1 = points[idx];
    const p2 = points[Math.min(numPoints, idx + 1)];
    const y = p1.y * (1 - lt) + p2.y * lt;
    terrain.push(y);
  }
  return terrain;
}

function getTerrainY(terrain, x) {
  const idx = Math.floor(x / 2);
  if (idx < 0) return terrain[0];
  if (idx >= terrain.length) return terrain[terrain.length - 1];
  return terrain[idx];
}

// === 발사 + 명중 시뮬 ===
function simulateShot(bot, target, terrain, wind) {
  // 봇 전략: 적까지 거리/높이 차로 angle/power 추정 + 약간의 노이즈
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 단순 포물선 추정: angle 45도 기준 + power 비례
  let serverAngle = (dx > 0) ? 45 : 135;
  let power = Math.min(150, Math.max(20, dist / 8 + Math.random() * 20));
  // 노이즈로 명중률 차이 (탱크별 사거리)
  serverAngle += (Math.random() - 0.5) * (8 / (bot.range || 1));
  power += (Math.random() - 0.5) * 10;

  const tankDef = TANK_TYPES[bot.tankType];
  const factor = (tankDef.range || 1) * 1.0;
  const rad = serverAngle * Math.PI / 180;
  let px = bot.x + Math.cos(rad) * 22;
  let py = (bot.y - 4) - Math.sin(rad) * 22;
  let vx = Math.cos(rad) * power * 0.18 * factor;
  let vy = -Math.sin(rad) * power * 0.18 * factor;
  for (let step = 0; step < 600; step++) {
    const speed = Math.sqrt(vx * vx + vy * vy);
    const drag = PROJECTILE_DRAG * speed;
    vx += wind * WIND_FACTOR + (-vx * drag);
    vy += GRAVITY + (-vy * drag);
    px += vx;
    py += vy;
    if (px < 0) px += CANVAS_WIDTH;
    if (px >= CANVAS_WIDTH) px -= CANVAS_WIDTH;
    if (py > CANVAS_HEIGHT) return { x: px, y: CANVAS_HEIGHT, speed: 0, miss: true };
    const tY = getTerrainY(terrain, px);
    if (py >= tY) return { x: px, y: tY, speed, miss: false };
    // 탱크 hit 체크
    for (const id of Object.keys(target._room.players)) {
      const tk = target._room.players[id];
      if (id === bot.id) continue;
      if (!tk.alive) continue;
      const tdx = tk.x - px;
      const tdy = tk.y - py;
      if (Math.sqrt(tdx * tdx + tdy * tdy) < 20) {
        return { x: px, y: py, speed, hitTank: tk };
      }
    }
  }
  return { x: px, y: py, speed: 0, miss: true };
}

function applyExplosion(room, shooter, x, y, speed, weaponType) {
  const tankDef = TANK_TYPES[shooter.tankType];
  let radius, maxDamage, pierce = 1;
  if (weaponType === 'normal') {
    const a = tankDef.ammo;
    radius = a.radius; maxDamage = a.damage; pierce = a.pierce || 1;
  } else if (weaponType === 'redbean') {
    const b = tankDef.bomb2;
    radius = b.radius || 5; maxDamage = b.damage || 30;
  } else {
    const u = tankDef.ultimate;
    radius = u.radius; maxDamage = u.damage;
  }
  const speedFactor = Math.max(0.35, Math.min(1.5, Math.pow(speed / SPEED_REF, 2)));
  Object.values(room.players).forEach(p => {
    if (!p.alive) return;
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius * 1.5) {
      const dmg = Math.max(5, Math.round(maxDamage * speedFactor * (1 - dist / (radius * 1.5)) * pierce));
      p.hp = Math.max(0, p.hp - dmg);
      if (p.id !== shooter.id) shooter.dealt += dmg;
      else shooter.selfDmg = (shooter.selfDmg || 0) + dmg;
      if (p.hp <= 0) {
        p.alive = false;
        if (p.id !== shooter.id) shooter.kills++;
      }
    }
  });
}

// === 한 판 시뮬 ===
function runMatch(matchIdx) {
  const tankList = Object.keys(TANK_TYPES);
  const room = { players: {}, terrain: generateTerrain(), wind: (Math.random() - 0.5) * 0.6 };
  // 6봇 — 각 탱크 1대씩
  tankList.forEach((tk, i) => {
    const tankDef = TANK_TYPES[tk];
    const slot = 100 + (CANVAS_WIDTH - 200) * (i / 5);
    const p = {
      id: tk + '_' + matchIdx,
      tankType: tk,
      x: slot, y: getTerrainY(room.terrain, slot) - 14,
      hp: tankDef.hp, maxHp: tankDef.hp, alive: true,
      range: tankDef.range,
      dealt: 0, kills: 0, turnsSurvived: 0,
      _room: room,
    };
    room.players[p.id] = p;
  });
  // 게임 루프: 최대 30턴
  for (let turn = 0; turn < 30; turn++) {
    const aliveIds = Object.keys(room.players).filter(id => room.players[id].alive);
    if (aliveIds.length <= 1) break;
    aliveIds.forEach(id => { room.players[id].turnsSurvived++; });
    // 각 봇이 차례로 발사
    for (const id of aliveIds) {
      const bot = room.players[id];
      if (!bot.alive) continue;
      // 타겟: 가장 가까운 살아있는 적
      let target = null, bestD = Infinity;
      Object.values(room.players).forEach(t => {
        if (t.id === bot.id || !t.alive) return;
        const d = Math.abs(t.x - bot.x);
        if (d < bestD) { bestD = d; target = t; }
      });
      if (!target) continue;
      // 무기 선택: 60% normal, 35% redbean, 5% ult (있으면)
      const r = Math.random();
      let weapon = 'normal';
      if (r > 0.6 && r < 0.95) weapon = 'redbean';
      // 발사
      const shot = simulateShot(bot, target, room.terrain, room.wind);
      if (shot.hitTank) {
        // 직접 hit → 폭발
        applyExplosion(room, bot, shot.x, shot.y, shot.speed, weapon);
      } else if (!shot.miss) {
        applyExplosion(room, bot, shot.x, shot.y, shot.speed, weapon);
      }
    }
    // 매 턴 wind 변동
    room.wind += (Math.random() - 0.5) * 0.2;
    room.wind = Math.max(-1, Math.min(1, room.wind));
  }
  // 결과
  const survivors = Object.values(room.players).filter(p => p.alive);
  const winner = survivors.length === 1 ? survivors[0].tankType : null;
  return {
    winner,
    survivors: survivors.length,
    stats: Object.values(room.players).map(p => ({
      tank: p.tankType, hp: p.hp, alive: p.alive,
      dealt: p.dealt, kills: p.kills, selfDmg: p.selfDmg || 0,
      turns: p.turnsSurvived,
    })),
  };
}

// === 30판 실행 + 통계 ===
console.log(`=== 봇 시뮬레이션 ${MATCHES}판 시작 ===`);
const startTime = Date.now();
const tankStats = {};
Object.keys(TANK_TYPES).forEach(tk => {
  tankStats[tk] = { wins: 0, kills: 0, dealt: 0, selfDmg: 0, survived: 0, plays: 0, hp: 0 };
});
const winnerLog = [];

for (let m = 0; m < MATCHES; m++) {
  try {
    const res = runMatch(m);
    if (res.winner) {
      tankStats[res.winner].wins++;
      winnerLog.push(res.winner);
    } else {
      winnerLog.push('-');
    }
    res.stats.forEach(s => {
      tankStats[s.tank].plays++;
      tankStats[s.tank].kills += s.kills;
      tankStats[s.tank].dealt += s.dealt;
      tankStats[s.tank].selfDmg += s.selfDmg;
      tankStats[s.tank].survived += s.turns;
      tankStats[s.tank].hp += s.hp;
    });
    process.stdout.write(`Match ${m + 1}/${MATCHES}: 우승=${res.winner || '무승부'}\n`);
  } catch (err) {
    console.error(`!!! Match ${m + 1} error:`, err.message);
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n=== 결과 (${MATCHES}판, ${elapsed}s) ===`);
const lines = [];
lines.push(`Tank   | Wins | Win% | AvgKill | AvgDealt | AvgSelfDmg | AvgSurvTurns | AvgRemHP`);
lines.push(`-------|------|------|---------|----------|------------|--------------|---------`);
Object.keys(tankStats).forEach(tk => {
  const s = tankStats[tk];
  const winPct = ((s.wins / MATCHES) * 100).toFixed(1);
  const avgK = (s.kills / s.plays).toFixed(2);
  const avgD = (s.dealt / s.plays).toFixed(1);
  const avgS = (s.selfDmg / s.plays).toFixed(1);
  const avgT = (s.survived / s.plays).toFixed(1);
  const avgHp = (s.hp / s.plays).toFixed(1);
  lines.push(`${tk.padEnd(6)} | ${String(s.wins).padStart(4)} | ${winPct.padStart(5)}% | ${avgK.padStart(7)} | ${avgD.padStart(8)} | ${avgS.padStart(10)} | ${avgT.padStart(12)} | ${avgHp.padStart(7)}`);
});
const summary = lines.join('\n');
console.log(summary);

// 결과 파일에 저장
const out = {
  matches: MATCHES,
  elapsed: elapsed,
  winnerLog,
  tankStats,
  summary,
};
const outPath = path.join(__dirname, `bot-sim-result-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n결과 저장: ${outPath}`);

// 밸런스 권고
console.log(`\n=== 밸런스 권고 ===`);
const ranked = Object.keys(tankStats).map(tk => ({ tk, winPct: tankStats[tk].wins / MATCHES }))
  .sort((a, b) => b.winPct - a.winPct);
console.log(`강 → 약 순:`);
ranked.forEach(r => console.log(`  ${r.tk}: ${(r.winPct * 100).toFixed(1)}%`));
const topPct = ranked[0].winPct, botPct = ranked[5].winPct;
if (topPct - botPct > 0.25) {
  console.log(`\n⚠ 격차 ${((topPct - botPct) * 100).toFixed(1)}% — 추가 밸런스 패치 필요`);
  console.log(`  너프 후보: ${ranked[0].tk}`);
  console.log(`  버프 후보: ${ranked[5].tk}`);
} else {
  console.log(`\n✓ 격차 ${((topPct - botPct) * 100).toFixed(1)}% — 균형 양호`);
}
