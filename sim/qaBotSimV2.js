// === QA 봇 시뮬레이터 V2 ===
//
// 개선 사항:
//   - EARLY_TURN false positive 보정 (자기 턴 관련만 체크)
//   - 팀전 모드 시뮬 (cooldown / 시즈 / 동시 발사)
//   - 장시간 마라톤 모드 (메모리 누적 모니터링)
//
// 사용:
//   node sim/qaBotSimV2.js                 (기본: 3판 일반전 + 2판 팀전 + 메모리 체크)
//   node sim/qaBotSimV2.js solo 5          (5판 일반전)
//   node sim/qaBotSimV2.js team 5          (5판 팀전)
//   node sim/qaBotSimV2.js marathon 600    (10분 메모리 모니터)

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const path = require('path');

const mode = process.argv[2] || 'all';
const arg = parseInt(process.argv[3]) || (mode === 'marathon' ? 600 : 3);
const SERVER_PORT = 3940;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const TANK_IDS = ['K2', 'M1A2', 'T90', 'T10', 'ZTZ99', 'LEO2'];

let serverProc;
let serverMemSamples = [];
const issues = [];
const log = (m) => console.log(`[QA2] ${m}`);
const issue = (cat, m) => { issues.push({ cat, m, t: Date.now() }); console.log(`❌ [${cat}] ${m}`); };

async function startServer() {
  log('localhost server 부팅...');
  return new Promise((resolve, reject) => {
    serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    serverProc.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('running on port') && !started) { started = true; setTimeout(resolve, 500); }
    });
    serverProc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('uncaughtException') || s.includes('TypeError') || s.includes('ReferenceError')) {
        issue('SERVER_CRASH', s.split('\n')[0].slice(0, 200));
      }
    });
    serverProc.on('error', reject);
    setTimeout(() => { if (!started) reject(new Error('server start timeout')); }, 10000);
  });
}

function killServer() {
  if (serverProc) try { serverProc.kill('SIGTERM'); } catch (_) {}
}

// 봇 객체 + 자기 턴 추적
function createBot(idx, tankId, roomId) {
  return new Promise((resolve) => {
    const bot = {
      idx, tankId, roomId,
      id: null,
      socket: null,
      state: null,
      tankTypes: null,
      lastShotAt: 0,
      lastShotProjectileSeen: false,
      lastShotTargetHp: null,
      lastShotTargetId: null,
      shotsFired: 0,
      shotsMissed: 0,
      hpDamageDealt: 0,
      myTurnStartedAt: 0,
      myTurnFiredAt: 0,
      // 팀전용
      lastCooldownEndAt: 0,
      siegeTransitions: 0,
    };
    bot.socket = io(SERVER_URL, {
      query: { room: roomId },
      auth: { token: '' },
      reconnection: false,
    });
    bot.socket.on('connect', () => {
      bot.id = bot.socket.id;
      bot.socket.emit('setName', `BOT_${idx}_${tankId}`);
      setTimeout(() => bot.socket.emit('setTank', tankId), 100);
      resolve(bot);
    });
    bot.socket.on('disconnect', (reason) => {
      // 의도된 종료(io client disconnect) 는 무시
      if (reason !== 'io client disconnect') {
        issue('DISCONNECT', `BOT_${idx} (${tankId}): ${reason}`);
      }
    });
    bot.socket.on('init', (data) => { bot.tankTypes = data.tankTypes; });
    bot.socket.on('gameState', (s) => {
      const prevState = bot.state;
      bot.state = s;
      // 무결성 체크
      if (s.phase === 'playing') {
        if (!s.players) { issue('STATE', `players undefined`); return; }
        for (const id of Object.keys(s.players)) {
          const p = s.players[id];
          if (p.hp != null && !Number.isFinite(p.hp)) issue('HP_NAN', `${p.name} hp=${p.hp}`);
          if (p.x != null && !Number.isFinite(p.x)) issue('POS_NAN', `${p.name} x=${p.x}`);
        }
      }
      // EARLY_TURN 보정: 자기 턴이 끝나는 경우만 체크
      if (prevState && s.phase === 'playing' && !s.teamMode) {
        const wasMyTurn = prevState.currentTurn === bot.id;
        const stillMine = s.currentTurn === bot.id;
        if (wasMyTurn && !stillMine) {
          // 내 턴이 끝남 — 내가 쏘기 전에 끝났으면 issue
          if (bot.myTurnFiredAt < bot.myTurnStartedAt) {
            const elapsed = Date.now() - bot.myTurnStartedAt;
            if (elapsed < 8000) {       // 정상 turn time 10s 이상
              issue('EARLY_TURN', `BOT_${idx}: 내 턴 ${elapsed}ms 만에 종료 (발사 X)`);
            }
          }
        }
        if (!wasMyTurn && stillMine) {
          bot.myTurnStartedAt = Date.now();
          bot.myTurnFiredAt = 0;
        }
      }
      // 시즈 전환 카운트
      if (prevState && s.players && bot.id && s.players[bot.id]) {
        const me = s.players[bot.id];
        const prevMe = prevState.players && prevState.players[bot.id];
        if (prevMe && me.siegeMode !== prevMe.siegeMode) bot.siegeTransitions++;
      }
    });
    bot.socket.on('projectileUpdate', (p) => {
      if (p && p.shooterId === bot.id) bot.lastShotProjectileSeen = true;
    });
  });
}

// 봇 AI — solo 모드 + team 모드 자동 대응
function botAct(bot, teamMode) {
  if (!bot.state || bot.state.phase !== 'playing') return;
  const me = bot.state.players[bot.id];
  if (!me || !me.alive) return;
  // 팀전: cooldown 체크
  if (teamMode) {
    if (Date.now() < (me.cooldownUntil || 0)) return;
    if (bot.state.projectile) return;
  } else {
    if (bot.state.currentTurn !== bot.id) return;
    if (bot.state.projectile) return;
  }
  // 타겟 (팀전: 다른 팀, 솔로: 가까운 적)
  let bestT = null, bestD = Infinity;
  Object.values(bot.state.players).forEach(p => {
    if (p.id === bot.id || !p.alive) return;
    if (teamMode && p.team === me.team) return;     // 같은 팀 X
    const d = Math.abs(p.x - me.x);
    if (d < bestD) { bestD = d; bestT = p; }
  });
  if (!bestT) return;
  const dx = bestT.x - me.x;
  const uiAngle = dx > 0 ? (35 + Math.random() * 20) : -(35 + Math.random() * 20);
  const serverAngle = 90 - uiAngle;
  const dist = Math.abs(dx);
  const power = Math.min(150, Math.max(30, dist / 8 + 25 + Math.random() * 20));
  bot.socket.emit('setAngle', Math.round(serverAngle));
  bot.socket.emit('setPower', Math.round(power));
  bot.lastShotTargetId = bestT.id;
  bot.lastShotTargetHp = bestT.hp;
  bot.lastShotProjectileSeen = false;
  setTimeout(() => {
    // 발사 전 자기 턴 / cooldown 재확인 (200ms 사이 turn 바뀌었을 수 있음)
    if (!bot.state || bot.state.phase !== 'playing') return;
    const me2 = bot.state.players[bot.id];
    if (!me2 || !me2.alive) return;
    if (teamMode) {
      if (Date.now() < (me2.cooldownUntil || 0)) return;
      if (bot.state.projectile) return;
    } else {
      if (bot.state.currentTurn !== bot.id) return;
      if (bot.state.projectile) return;
    }
    bot.socket.emit('fire');
    bot.lastShotAt = Date.now();
    bot.myTurnFiredAt = Date.now();
    bot.shotsFired++;
    setTimeout(() => {
      if (!bot.lastShotProjectileSeen) {
        issue('NO_PROJECTILE', `BOT_${bot.idx} (${bot.tankId}): fire 후 projectile 미수신`);
        bot.shotsMissed++;
      }
    }, 3000);
    setTimeout(() => {
      if (!bot.state || !bot.state.players) return;
      const target = bot.state.players[bot.lastShotTargetId];
      if (!target) return;
      const dmg = (bot.lastShotTargetHp || 0) - (target.hp || 0);
      if (dmg > 0) bot.hpDamageDealt += dmg;
    }, 6000);
  }, 200);
}

// 시즈 토글 (팀전 전용, 30% 확률)
function botTrySiege(bot) {
  if (!bot.state || !bot.state.teamMode) return;
  if (!bot.state.players[bot.id]) return;
  if (Math.random() > 0.30) return;
  bot.socket.emit('toggleSiege');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runMatch(matchIdx, opts = {}) {
  const teamMode = !!opts.teamMode;
  log(`=== Match ${matchIdx + 1} (${teamMode ? '팀전' : '일반전'}) ===`);
  const roomId = `qa${teamMode ? 'T' : 'S'}${matchIdx}${Math.floor(Math.random() * 999)}`;
  const bots = [];
  for (let i = 0; i < 6; i++) {
    bots.push(await createBot(i, TANK_IDS[i], roomId));
    await sleep(120);
  }
  await sleep(1200);
  if (teamMode) {
    bots[0].socket.emit('setTeamMode', true);
    await sleep(400);
  }
  bots[0].socket.emit('startGame');
  log(`시작 — ${bots.length} 봇`);
  const matchStart = Date.now();
  const maxMatchMs = teamMode ? 60 * 1000 : 75 * 1000;
  let siegeAttempts = 0;
  while (Date.now() - matchStart < maxMatchMs) {
    await sleep(250);
    for (const b of bots) botAct(b, teamMode);
    // 팀전: 시즈 시도
    if (teamMode && siegeAttempts < 3 && Math.random() < 0.05) {
      const idx = Math.floor(Math.random() * bots.length);
      botTrySiege(bots[idx]);
      siegeAttempts++;
    }
    if (bots[0].state && bots[0].state.phase === 'gameover') break;
  }
  const totalShots = bots.reduce((s, b) => s + b.shotsFired, 0);
  const totalMisses = bots.reduce((s, b) => s + b.shotsMissed, 0);
  const totalDmg = bots.reduce((s, b) => s + b.hpDamageDealt, 0);
  const totalSiege = bots.reduce((s, b) => s + b.siegeTransitions, 0);
  log(`Match ${matchIdx + 1} 완료 — 발사 ${totalShots} / 미수신 ${totalMisses} / 데미지 ${totalDmg} / 시즈전환 ${totalSiege}`);
  bots.forEach(b => { try { b.socket.disconnect(); } catch (_) {} });
  await sleep(600);
  return { shots: totalShots, misses: totalMisses, dmg: totalDmg, siege: totalSiege, teamMode };
}

// 메모리 모니터 — server process RSS sample
function sampleMemory() {
  if (!serverProc || !serverProc.pid) return;
  try {
    const { execSync } = require('child_process');
    const out = execSync(`ps -o rss= -p ${serverProc.pid}`).toString().trim();
    const rssKb = parseInt(out);
    if (Number.isFinite(rssKb)) {
      serverMemSamples.push({ t: Date.now(), rssKb });
    }
  } catch (_) {}
}

async function marathon(seconds) {
  log(`=== 마라톤 모드 ${seconds}s — 메모리 누적 모니터 ===`);
  const memInterval = setInterval(sampleMemory, 5000);
  const matchCount = Math.max(1, Math.floor(seconds / 60));
  const results = [];
  for (let i = 0; i < matchCount; i++) {
    sampleMemory();
    const isTeam = i % 2 === 1;
    try { results.push(await runMatch(i, { teamMode: isTeam })); }
    catch (e) { issue('MATCH_FAIL', `${i + 1}: ${e.message}`); }
  }
  clearInterval(memInterval);
  // 메모리 분석
  if (serverMemSamples.length >= 2) {
    const first = serverMemSamples[0].rssKb;
    const last = serverMemSamples[serverMemSamples.length - 1].rssKb;
    const peak = Math.max(...serverMemSamples.map(s => s.rssKb));
    const grew = last - first;
    log(`메모리: 시작 ${(first / 1024).toFixed(1)}MB → 종료 ${(last / 1024).toFixed(1)}MB (피크 ${(peak / 1024).toFixed(1)}MB, 증가 ${(grew / 1024).toFixed(1)}MB)`);
    if (grew > 50 * 1024) issue('MEM_LEAK', `RSS ${(grew / 1024).toFixed(1)}MB 증가 (누수 의심)`);
  }
  return results;
}

async function main() {
  await startServer();
  log(`server up ${SERVER_URL}`);
  const allResults = [];
  if (mode === 'solo') {
    for (let i = 0; i < arg; i++) allResults.push(await runMatch(i, { teamMode: false }));
  } else if (mode === 'team') {
    for (let i = 0; i < arg; i++) allResults.push(await runMatch(i, { teamMode: true }));
  } else if (mode === 'marathon') {
    allResults.push(...(await marathon(arg)));
  } else {
    // all: 솔로 + 팀 + 메모리
    log('통합 모드: 솔로 3판 + 팀전 2판 + 메모리 sample');
    const memInterval = setInterval(sampleMemory, 5000);
    for (let i = 0; i < 3; i++) allResults.push(await runMatch(i, { teamMode: false }));
    for (let i = 0; i < 2; i++) allResults.push(await runMatch(3 + i, { teamMode: true }));
    clearInterval(memInterval);
    if (serverMemSamples.length >= 2) {
      const first = serverMemSamples[0].rssKb;
      const last = serverMemSamples[serverMemSamples.length - 1].rssKb;
      const grew = last - first;
      log(`메모리: ${(first / 1024).toFixed(1)}MB → ${(last / 1024).toFixed(1)}MB (증가 ${(grew / 1024).toFixed(1)}MB)`);
      if (grew > 30 * 1024) issue('MEM_LEAK', `RSS ${(grew / 1024).toFixed(1)}MB 증가`);
    }
  }
  // 보고서
  console.log(`\n========== QA V2 결과 ==========`);
  const totalShots = allResults.reduce((s, r) => s + r.shots, 0);
  const totalMisses = allResults.reduce((s, r) => s + r.misses, 0);
  const totalDmg = allResults.reduce((s, r) => s + r.dmg, 0);
  const totalSiege = allResults.reduce((s, r) => s + (r.siege || 0), 0);
  console.log(`매치: ${allResults.length}판 (솔로 ${allResults.filter(r=>!r.teamMode).length} / 팀전 ${allResults.filter(r=>r.teamMode).length})`);
  console.log(`총 발사: ${totalShots}, projectile 미수신: ${totalMisses} (${((totalMisses / Math.max(1, totalShots)) * 100).toFixed(1)}%)`);
  console.log(`총 데미지: ${totalDmg}, 시즈 전환 횟수: ${totalSiege}`);
  console.log(`\n=== 이슈 (${issues.length}건) ===`);
  const grouped = {};
  issues.forEach(i => { grouped[i.cat] = (grouped[i.cat] || 0) + 1; });
  Object.entries(grouped).forEach(([cat, n]) => console.log(`  ${cat}: ${n}`));
  if (issues.length > 0) {
    console.log(`\n샘플:`);
    issues.slice(0, 12).forEach(i => console.log(`  [${i.cat}] ${i.m}`));
  } else {
    console.log(`  (없음) ✓`);
  }
  killServer();
  setTimeout(() => process.exit(0), 500);
}

main().catch(err => {
  console.error('main error:', err);
  killServer();
  process.exit(1);
});
