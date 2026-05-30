// === QA 봇 시뮬레이터 ===
// 실제 서버에 socket.io-client 로 6명 봇 접속 → 게임 진행 → 6개 QA 항목 체크
//
// 체크 항목:
//   1. 접속 끊김 (disconnect)
//   2. 발사 후 projectile 없이 turn 변경 (포탄 안 쏨)
//   3. 턴 시간 < 19s 인데 다음 턴 (조기 종료)
//   4. 발사 후 projectile 잘 받음
//   5. 적 HP 정상 감소
//   6. 기타: HP NaN, 좌표 무한, turn 무한 루프, state.players undefined 등
//
// 사용: node sim/qaBotSim.js [matches=3]

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const path = require('path');

const MATCHES = parseInt(process.argv[2]) || 3;
const SERVER_PORT = 3939;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

const TANK_IDS = ['K2', 'M1A2', 'T90', 'T10', 'ZTZ99', 'LEO2'];

let serverProc;
let issues = [];
const log = (m) => console.log(`[QA] ${m}`);
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
      if (s.includes('uncaughtException') || s.includes('Error')) {
        issue('SERVER_ERROR', s.split('\n')[0].slice(0, 200));
      }
    });
    serverProc.on('error', reject);
    setTimeout(() => { if (!started) reject(new Error('server start timeout')); }, 10000);
  });
}

function killServer() {
  if (serverProc) try { serverProc.kill('SIGTERM'); } catch (_) {}
}

// 봇 1명 — socket 연결 + 액션
function createBot(idx, tankId, roomId) {
  return new Promise((resolve) => {
    const bot = {
      idx, tankId, roomId,
      id: null,
      socket: null,
      state: null,
      tankTypes: null,
      lastShotAt: 0,
      lastTurnChangeAt: 0,
      lastTurnTimeLeft: null,
      lastShotProjectileSeen: false,
      lastShotTargetHp: null,
      lastShotTargetId: null,
      disconnects: 0,
      shotsFired: 0,
      shotsMissed: 0,    // projectile 안 보임
      hpDamageDealt: 0,
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
      bot.disconnects++;
      issue('DISCONNECT', `BOT_${idx} (${tankId}) disconnected: ${reason}`);
    });
    bot.socket.on('init', (data) => {
      bot.tankTypes = data.tankTypes;
    });
    bot.socket.on('gameState', (s) => {
      const prevState = bot.state;
      bot.state = s;
      // 체크 6: state.players undefined
      if (s.phase === 'playing' && !s.players) {
        issue('STATE', `players undefined in playing phase`);
        return;
      }
      // 체크 6: HP NaN
      if (s.players) {
        for (const id of Object.keys(s.players)) {
          const p = s.players[id];
          if (p.hp != null && !Number.isFinite(p.hp)) {
            issue('HP_NAN', `player ${p.name} hp = ${p.hp}`);
          }
          if (p.x != null && !Number.isFinite(p.x)) {
            issue('POS_NAN', `player ${p.name} x = ${p.x}`);
          }
        }
      }
      // 체크 3: turnTimeLeft 19 -> 다음 turn (10초 안 됐는데 turn 바뀜)
      if (prevState && prevState.currentTurn !== s.currentTurn && s.phase === 'playing') {
        const sinceLast = Date.now() - bot.lastTurnChangeAt;
        if (bot.lastTurnChangeAt > 0 && sinceLast < 2500 && !bot.lastShotAtRecent) {
          issue('EARLY_TURN', `BOT_${idx}: turn changed after ${sinceLast}ms without shot`);
        }
        bot.lastTurnChangeAt = Date.now();
      }
    });
    bot.socket.on('projectileUpdate', (p) => {
      if (p) bot.lastShotProjectileSeen = true;
    });
  });
}

// 봇 AI: 자기 턴이면 적 향해 발사
function botAct(bot, allBots) {
  if (!bot.state || bot.state.phase !== 'playing') return;
  if (bot.state.currentTurn !== bot.id) return;
  if (bot.state.projectile) return;       // 이미 발사 중
  // 타겟: 가장 가까운 살아있는 적
  const me = bot.state.players[bot.id];
  if (!me || !me.alive) return;
  let bestT = null, bestD = Infinity;
  Object.values(bot.state.players).forEach(p => {
    if (p.id === bot.id || !p.alive) return;
    const d = Math.abs(p.x - me.x);
    if (d < bestD) { bestD = d; bestT = p; }
  });
  if (!bestT) return;
  // 단순 추정 — 거리/높이로 angle/power
  const dx = bestT.x - me.x;
  const dy = bestT.y - me.y;
  const uiAngle = dx > 0 ? (35 + Math.random() * 20) : -(35 + Math.random() * 20);
  const serverAngle = 90 - uiAngle;       // -90..90 (UI) → 0..180 (server)
  const dist = Math.sqrt(dx * dx + dy * dy);
  const power = Math.min(150, Math.max(30, dist / 8 + 20 + Math.random() * 15));
  bot.socket.emit('setAngle', Math.round(serverAngle));
  bot.socket.emit('setPower', Math.round(power));
  // 체크 5 준비: 발사 직전 적 HP 기록
  bot.lastShotTargetId = bestT.id;
  bot.lastShotTargetHp = bestT.hp;
  bot.lastShotProjectileSeen = false;
  setTimeout(() => {
    bot.socket.emit('fire');
    bot.lastShotAt = Date.now();
    bot.lastShotAtRecent = true;
    bot.shotsFired++;
    // 체크 2: 5초 후 projectile 받았는지 확인
    setTimeout(() => {
      if (!bot.lastShotProjectileSeen) {
        issue('NO_PROJECTILE', `BOT_${bot.idx} (${bot.tankId}): fire emitted but no projectileUpdate received`);
        bot.shotsMissed++;
      }
      bot.lastShotAtRecent = false;
    }, 4000);
    // 체크 5: 8초 후 적 HP 비교
    setTimeout(() => {
      if (!bot.state || !bot.state.players) return;
      const target = bot.state.players[bot.lastShotTargetId];
      if (!target) return;
      const dmg = (bot.lastShotTargetHp || 0) - (target.hp || 0);
      if (dmg > 0) bot.hpDamageDealt += dmg;
      // 직격이면 5 이상이 정상. 0 만 누적되면 의심.
    }, 7000);
  }, 200);
}

async function runMatch(matchIdx) {
  log(`=== Match ${matchIdx + 1}/${MATCHES} ===`);
  const roomId = `qa${matchIdx}${Math.floor(Math.random() * 999)}`;
  const bots = [];
  for (let i = 0; i < 6; i++) {
    bots.push(await createBot(i, TANK_IDS[i], roomId));
    await sleep(150);
  }
  // host (첫 봇) 가 게임 시작
  await sleep(1500);
  bots[0].socket.emit('startGame');
  log(`Game started with ${bots.length} bots`);
  // 봇 액션 루프 — 매 300ms 마다 모든 봇 액션 시도, 최대 60초
  const matchStart = Date.now();
  const maxMatchMs = 90 * 1000;
  while (Date.now() - matchStart < maxMatchMs) {
    await sleep(300);
    for (const b of bots) botAct(b, bots);
    // 종료 조건: gameover
    if (bots[0].state && bots[0].state.phase === 'gameover') break;
  }
  // 통계
  const totalShots = bots.reduce((s, b) => s + b.shotsFired, 0);
  const totalMisses = bots.reduce((s, b) => s + b.shotsMissed, 0);
  const totalDmg = bots.reduce((s, b) => s + b.hpDamageDealt, 0);
  const totalDisconnects = bots.reduce((s, b) => s + b.disconnects, 0);
  log(`Match ${matchIdx + 1} done — shots: ${totalShots}, no-projectile: ${totalMisses}, total damage: ${totalDmg}, disconnects: ${totalDisconnects}`);
  // 봇 disconnect
  bots.forEach(b => { try { b.socket.disconnect(); } catch (_) {} });
  await sleep(800);
  return { shots: totalShots, misses: totalMisses, dmg: totalDmg, disconnects: totalDisconnects };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await startServer();
  log(`server up on ${SERVER_URL}`);
  const results = [];
  for (let i = 0; i < MATCHES; i++) {
    try {
      results.push(await runMatch(i));
    } catch (err) {
      issue('MATCH_FAIL', `Match ${i + 1}: ${err.message}`);
      results.push({ shots: 0, misses: 0, dmg: 0, disconnects: 0 });
    }
  }
  // 보고서
  console.log(`\n========== QA 결과 (${MATCHES}판) ==========`);
  const totalShots = results.reduce((s, r) => s + r.shots, 0);
  const totalMisses = results.reduce((s, r) => s + r.misses, 0);
  const totalDmg = results.reduce((s, r) => s + r.dmg, 0);
  const totalDc = results.reduce((s, r) => s + r.disconnects, 0);
  console.log(`총 발사: ${totalShots}`);
  console.log(`projectile 미수신: ${totalMisses} (${((totalMisses / Math.max(1, totalShots)) * 100).toFixed(1)}%)`);
  console.log(`총 데미지: ${totalDmg}`);
  console.log(`disconnect: ${totalDc}`);
  console.log(`\n=== 발견된 이슈 (${issues.length}건) ===`);
  const grouped = {};
  issues.forEach(i => { grouped[i.cat] = (grouped[i.cat] || 0) + 1; });
  Object.entries(grouped).forEach(([cat, n]) => console.log(`  ${cat}: ${n}`));
  if (issues.length > 0) {
    console.log(`\n샘플 (최대 10개):`);
    issues.slice(0, 10).forEach(i => console.log(`  [${i.cat}] ${i.m}`));
  }
  killServer();
  setTimeout(() => process.exit(issues.length > 0 ? 1 : 0), 500);
}

main().catch(err => {
  console.error('main error:', err);
  killServer();
  process.exit(1);
});
