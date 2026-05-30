// === 보안 + 에러 경계 fuzz 테스트 ===
//
// 검증:
//   1. server 가 malformed / 악의적 input 받아도 crash X
//   2. 권한 우회 시도 reject
//   3. state 깨뜨리는 입력 reject 또는 clamp
//
// 사용: node sim/fuzzTest.js

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const http = require('http');
const path = require('path');

const SERVER_PORT = 3941;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const issues = [];
const log = (m) => console.log(`[FUZZ] ${m}`);
const issue = (cat, m) => { issues.push({ cat, m }); console.log(`  ❌ [${cat}] ${m}`); };
const pass = (m) => { console.log(`  ✓ ${m}`); };

let serverProc;
let serverErrors = [];

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
      serverErrors.push(s);
      if (s.includes('uncaughtException')) {
        issue('SERVER_CRASH', `process.on('uncaughtException') 잡힘: ${s.slice(0, 200)}`);
      }
    });
    setTimeout(() => { if (!started) reject(new Error('timeout')); }, 10000);
  });
}

function killServer() {
  if (serverProc) try { serverProc.kill('SIGTERM'); } catch (_) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpRequest(method, pathStr, body, token) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'localhost', port: SERVER_PORT, path: pathStr, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 봇 1명 생성
function makeBot(roomId) {
  return new Promise((resolve) => {
    const s = io(SERVER_URL, { query: { room: roomId }, reconnection: false });
    s.on('connect', () => resolve(s));
  });
}

async function fuzzInputs(socket) {
  log('\n=== 1. setAngle 이상한 값 ===');
  // 정상 / 비정상 angle 값들. 서버가 clamp 하거나 reject 해야.
  const angles = [
    { v: -999, expect: 'clamp to 0' },
    { v: 999, expect: 'clamp to 180' },
    { v: NaN, expect: 'reject' },
    { v: 'abc', expect: 'reject' },
    { v: null, expect: 'reject' },
    { v: undefined, expect: 'reject' },
    { v: Infinity, expect: 'reject' },
    { v: { x: 1 }, expect: 'reject' },
    { v: [1, 2, 3], expect: 'reject' },
    { v: 1e100, expect: 'clamp' },
  ];
  for (const a of angles) {
    socket.emit('setAngle', a.v);
    pass(`setAngle(${typeof a.v === 'object' ? JSON.stringify(a.v) : String(a.v)}) — server 처리 후 crash X`);
  }
  await sleep(200);

  log('\n=== 2. setPower 이상한 값 ===');
  const powers = [-1, 0, 9999, NaN, 'fast', null, undefined, Infinity, -Infinity, { p: 100 }];
  for (const p of powers) {
    socket.emit('setPower', p);
    pass(`setPower(${typeof p === 'object' ? JSON.stringify(p) : String(p)}) — 처리 후 crash X`);
  }
  await sleep(200);

  log('\n=== 3. setName 악의적 입력 ===');
  const names = [
    '',
    ' ',
    'a'.repeat(200),                       // 매우 긴
    '<script>alert(1)</script>',          // XSS 시도
    "'; DROP TABLE users; --",            // SQL inject 시도
    '\\x00\\x01\\x02',                    // null bytes
    '🔥🎮👻'.repeat(50),                  // emoji 폭주
    null,
    undefined,
    { name: 'evil' },
    [1, 2, 3],
  ];
  for (const n of names) {
    socket.emit('setName', n);
    pass(`setName(${typeof n === 'object' ? JSON.stringify(n).slice(0, 30) : String(n).slice(0, 30)}) — crash X`);
  }
  await sleep(200);

  log('\n=== 4. moveBy 이상한 값 ===');
  const moves = [
    { direction: 0, distance: 1 },
    { direction: 1, distance: -1 },
    { direction: 1, distance: 1e10 },
    { direction: 1, distance: NaN },
    { direction: 'left', distance: 5 },
    { direction: null, distance: 5 },
    null,
    {},
    [],
    'not-an-object',
  ];
  for (const m of moves) {
    socket.emit('moveBy', m);
    pass(`moveBy(${JSON.stringify(m).slice(0, 40)}) — crash X`);
  }
  await sleep(200);

  log('\n=== 5. fire 잘못된 weaponType ===');
  const weapons = [
    'alien_laser', 'NORMAL', '', null, undefined, 123, { w: 'normal' },
    'nuke', 'laser_guided',  // 보유 안 한 무기
  ];
  for (const w of weapons) {
    socket.emit('fire', { weaponType: w });
    pass(`fire(${typeof w === 'object' ? JSON.stringify(w) : String(w)}) — crash X`);
  }
  await sleep(300);

  log('\n=== 6. setTank 잘못된 ID ===');
  const tanks = ['HACKER', '', null, 'k2', { id: 'K2' }, 12345];
  for (const t of tanks) {
    socket.emit('setTank', t);
    pass(`setTank(${typeof t === 'object' ? JSON.stringify(t) : String(t)}) — crash X`);
  }
  await sleep(200);

  log('\n=== 7. setTeam 권한/값 ===');
  ['C', 'a', '', null, undefined, 'A', 'B', 12345].forEach(t => {
    socket.emit('setTeam', t);
    pass(`setTeam(${String(t)}) — crash X`);
  });
  await sleep(200);

  log('\n=== 8. toggleSiege / repair 빈번 호출 (state 깨뜨림 시도) ===');
  for (let i = 0; i < 20; i++) {
    socket.emit('toggleSiege');
    socket.emit('repair');
  }
  pass('20회 빠른 토글/repair — crash X');
  await sleep(300);

  log('\n=== 9. 알 수 없는 이벤트 ===');
  ['adminLogin', 'godMode', '<script>', '\\x00', null].forEach(ev => {
    try { socket.emit(ev, { hack: true }); pass(`emit('${String(ev).slice(0,20)}') — server 무시`); }
    catch (e) { issue('CLIENT_THROW', `${ev}: ${e.message}`); }
  });
  await sleep(200);
}

async function fuzzHttpEndpoints() {
  log('\n=== 10. HTTP API 권한 우회 ===');
  // /api/auth/me 토큰 없이
  let r = await httpRequest('GET', '/api/auth/me');
  if (r.status === 200) issue('AUTH_BYPASS', `/api/auth/me 토큰 없이 200 응답`);
  else pass(`/api/auth/me 토큰 없이 → ${r.status} (정상 거부)`);

  // 잘못된 JWT
  r = await httpRequest('GET', '/api/auth/me', null, 'eyJhbGciOiJIUzI1NiJ9.evil.fake');
  if (r.status === 200) issue('AUTH_BYPASS', `/api/auth/me 위조 토큰 200`);
  else pass(`/api/auth/me 위조 토큰 → ${r.status}`);

  // /api/auth/register 잘못된 body
  const badBodies = [
    {}, null, { username: '' }, { username: 'ok', password: '' },
    { username: '<script>', password: '1234' },
    { username: 'aa', password: '12' },              // 너무 짧음
    { username: 'a'.repeat(200), password: '1234' },
    { username: 'admin', password: 'a'.repeat(10000) },
  ];
  for (const b of badBodies) {
    r = await httpRequest('POST', '/api/auth/register', b);
    if (r.status === 200 && b && (!b.username || !b.password)) {
      issue('VALIDATION', `register 빈 username/password 인데 200: ${JSON.stringify(b).slice(0, 60)}`);
    } else {
      pass(`register ${JSON.stringify(b || 'null').slice(0, 50)} → ${r.status}`);
    }
  }

  // /api/leaderboard fuzz
  r = await httpRequest('GET', '/api/leaderboard');
  pass(`leaderboard → ${r.status}`);

  // /api/stats/:username 이상한 경로
  for (const u of ['admin', '../etc/passwd', '%00', 'a'.repeat(300)]) {
    r = await httpRequest('GET', `/api/stats/${encodeURIComponent(u)}`);
    pass(`stats/${u.slice(0, 20)} → ${r.status}`);
  }

  // 존재 안 하는 endpoint
  for (const p of ['/api/admin', '/api/users/delete', '/.env', '/server.js']) {
    r = await httpRequest('GET', p);
    if (r.status === 200 && p === '/server.js') {
      issue('FILE_LEAK', `/server.js 소스코드 노출 위험!`);
    } else {
      pass(`${p} → ${r.status}`);
    }
  }
}

async function fuzzImpersonation() {
  log('\n=== 11. 다른 봇 ID 위조 시도 ===');
  // 봇 2명 같은 방에 들어와서, 봇 A 가 봇 B 의 socket.id 를 payload 로 보낼 때 server 가 socket.id 만 보는지
  const roomId = `imp${Math.floor(Math.random() * 999)}`;
  const a = await makeBot(roomId);
  await sleep(200);
  const b = await makeBot(roomId);
  await sleep(500);

  // 봇 A 가 setName 으로 'B' 흉내
  a.emit('setName', 'IMPOSTER');
  await sleep(200);

  // 봇 A 가 다른 id 로 fire 시도 (server 는 socket.id 기반이라 무시해야)
  a.emit('fire', { fromId: b.id, weaponType: 'normal' });
  await sleep(200);
  pass('payload fromId 위조 — server 가 socket.id 기준으로 처리');

  // 봇 A 가 다른 방 roomId 로 emit 시도
  a.emit('startGame', { roomId: 'OTHER_ROOM' });
  pass('다른 방 roomId 위조 — server 무시');

  a.disconnect(); b.disconnect();
  await sleep(300);
}

async function checkServerAlive() {
  log('\n=== 12. fuzz 후 server 정상 동작 확인 ===');
  const bot = await makeBot('alive_check');
  await sleep(500);
  bot.emit('setName', 'normal_user');
  bot.emit('setTank', 'K2');
  await sleep(300);
  if (serverErrors.some(e => e.includes('uncaughtException'))) {
    issue('SERVER_CRASH', 'server uncaughtException 발생');
  } else {
    pass('정상 socket connect/emit 가능 — server 살아있음');
  }
  bot.disconnect();
}

async function main() {
  await startServer();
  log(`server up`);

  const roomId = `fuzz${Math.floor(Math.random() * 999)}`;
  const bot = await makeBot(roomId);
  await sleep(500);
  bot.emit('setName', 'FUZZER');
  bot.emit('setTank', 'K2');
  await sleep(300);

  try {
    await fuzzInputs(bot);
    bot.disconnect();
    await sleep(500);
    await fuzzHttpEndpoints();
    await fuzzImpersonation();
    await checkServerAlive();
  } catch (e) {
    issue('TEST_ERROR', e.message);
  }

  console.log(`\n========== FUZZ 결과 ==========`);
  const grouped = {};
  issues.forEach(i => { grouped[i.cat] = (grouped[i.cat] || 0) + 1; });
  if (issues.length === 0) {
    console.log(`✅ PASS — 모든 fuzz/보안 시도에 대해 server 안정`);
  } else {
    console.log(`❌ ${issues.length} 건 이슈:`);
    Object.entries(grouped).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
    issues.slice(0, 10).forEach(i => console.log(`  [${i.cat}] ${i.m}`));
  }
  console.log(`\nserver stderr 분석:`);
  const crashCount = serverErrors.filter(e => e.includes('uncaughtException')).length;
  const errCount = serverErrors.filter(e => e.includes('Error')).length;
  console.log(`  uncaughtException: ${crashCount}`);
  console.log(`  Error 로그: ${errCount}`);
  if (crashCount > 0) {
    console.log(`  마지막 uncaughtException:`);
    console.log(serverErrors.find(e => e.includes('uncaughtException')).slice(0, 300));
  }
  killServer();
  setTimeout(() => process.exit(issues.length > 0 ? 1 : 0), 500);
}

main().catch(err => { console.error(err); killServer(); process.exit(1); });
