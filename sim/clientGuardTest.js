// === 클라이언트 가드 unit test (jsdom) ===
// 봇 시뮬이 못 잡는 클라 wrapper 함수 가드를 직접 검증
//
// 검증 함수: fire, moveTankByDistance, useRepair, toggleDoubleShot, selectWeapon
// 각 함수가 솔로/팀전, 자기턴/남턴, alive/dead 조건에서 올바르게 socket.emit 호출하는지 확인

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML = `<!DOCTYPE html><html><body>
  <div id="lobby"></div>
  <div id="gameContainer"></div>
  <canvas id="gameCanvas" width="1400" height="700"></canvas>
  <div id="playerSlots"></div>
  <button id="btnStart"></button>
  <input id="nameInput" />
  <input id="angleSlider" />
  <input id="powerSlider" />
  <input id="angleInput" />
  <input id="powerInput" />
  <input id="moveDistInput" value="2" />
  <button class="btn-weapon"></button>
  <span id="laserCountInBtn"></span>
  <button id="btnFire"></button>
  <button id="btnMoveLeft"></button>
  <button id="btnMoveRight"></button>
  <button id="btnDoubleShot"></button>
  <span id="doubleShotCount"></span>
  <div id="hud"></div>
  <div id="hudRoom"></div>
  <div id="turnName"></div>
  <div id="turnDot"></div>
  <div id="turnLabel"></div>
  <div id="timerCircle"></div>
  <div id="windArrow"></div>
  <div id="windValue"></div>
  <div id="moveBudgetValue"></div>
  <div id="lobbyChatMessages"></div>
  <input id="lobbyChatInput" />
  <div id="gameChatMessages"></div>
  <input id="gameChatInput" />
  <div id="gameChat"></div>
  <div id="gcToggleIcon"></div>
  <div id="scoreboard"></div>
  <div id="scoreList"></div>
  <div id="scoreTitle"></div>
  <div id="lobbyCountdown"></div>
  <div id="toast"></div>
  <div id="authGuest"></div>
  <div id="authUser"></div>
  <div id="authUserName"></div>
  <div id="authUserStats"></div>
  <div id="authModal"></div>
  <input id="authUsername" />
  <input id="authPassword" />
  <div id="authError"></div>
  <button id="authSubmit"></button>
  <div id="authModalTitle"></div>
  <div id="authSwitchText"></div>
  <a id="authSwitchLink"></a>
  <div id="statsModal"></div>
  <div id="statsModalTitle"></div>
  <div id="statsModalBody"></div>
  <div id="tankGrid"></div>
</body></html>`;

const dom = new JSDOM(HTML, { url: 'http://localhost/' });

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

// 폰트 로딩 시도 차단
dom.window.document.fonts = { load: () => Promise.resolve() };

// canvas getContext stub (테스트엔 실제 렌더 X)
HTMLCanvasElement.prototype.getContext = function() {
  return {
    save: ()=>{}, restore: ()=>{}, translate: ()=>{}, rotate: ()=>{}, scale: ()=>{},
    clearRect: ()=>{}, fillRect: ()=>{}, strokeRect: ()=>{}, beginPath: ()=>{}, closePath: ()=>{},
    moveTo: ()=>{}, lineTo: ()=>{}, bezierCurveTo: ()=>{}, quadraticCurveTo: ()=>{}, arc: ()=>{},
    ellipse: ()=>{}, roundRect: ()=>{}, fill: ()=>{}, stroke: ()=>{}, fillText: ()=>{}, strokeText: ()=>{},
    createLinearGradient: ()=>({ addColorStop: ()=>{} }),
    createRadialGradient: ()=>({ addColorStop: ()=>{} }),
    measureText: ()=>({ width: 0 }),
    setLineDash: ()=>{}, getLineDash: ()=>[],
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineCap: '', lineJoin: '',
  };
};

// === mock socket ===
const emittedEvents = [];
const mockSocket = {
  on: () => {},
  emit: (ev, ...args) => { emittedEvents.push({ ev, args }); },
  disconnect: () => {},
  connect: () => {},
  id: 'me',
};
global.io = (() => mockSocket);
dom.window.io = global.io;

// === game.js 로드 ===
const gameJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');
// game.js 마지막의 const socket = io({...}) 가 mockSocket 받음
// const 들이 module scope 라 eval 안에서만 살아있음. window 에 노출 필요.
const wrapper = gameJs + '\n\n' +
  // 테스트 대상 함수를 window 에 노출
  'window.__test = { fire, moveTankByDistance, useRepair, toggleDoubleShot, selectWeapon, canAct };' +
  '\nwindow.__setState = (s) => { state = s; };' +
  '\nwindow.__setMyId = (id) => { myId = id; };' +
  '\nwindow.__setWeapon = (w) => { currentWeapon = w; };';

try {
  dom.window.eval(wrapper);
} catch (err) {
  console.error('eval 실패:', err.message.slice(0, 300));
  process.exit(1);
}

const T = dom.window.__test;
const setState = dom.window.__setState;
const setMyId = dom.window.__setMyId;
const setWeapon = dom.window.__setWeapon;

setMyId('me');

let pass = 0, fail = 0;
function test(name, fn) {
  emittedEvents.length = 0;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name} — ${e.message}`);
    fail++;
  }
}
function assertEmit(ev, msg) {
  if (!emittedEvents.some(e => e.ev === ev)) {
    throw new Error(`'${ev}' emit 안 됨 (실제: ${JSON.stringify(emittedEvents.map(e=>e.ev))})${msg ? ' — ' + msg : ''}`);
  }
}
function assertNoEmit(ev, msg) {
  if (emittedEvents.some(e => e.ev === ev)) {
    throw new Error(`'${ev}' emit 됨 (안 돼야 함)${msg ? ' — ' + msg : ''}`);
  }
}

const baseSolo = (alive = true, isMine = true) => ({
  teamMode: false,
  currentTurn: isMine ? 'me' : 'other',
  players: {
    me: { id: 'me', alive, x: 500, y: 500, hp: 100, maxHp: 100, color: '#fff',
          moveBudget: 50, doubleShots: 2, doubleShotPending: false, repairKits: 1,
          laserShots: 1, nukeShots: 1, tankType: 'K2' },
    other: { id: 'other', alive: true, x: 700, y: 500, hp: 100, maxHp: 100, color: '#f00', tankType: 'K2' },
  },
});
const baseTeam = (alive = true) => ({
  teamMode: true,
  currentTurn: null,
  players: {
    me: { id: 'me', team: 'A', alive, x: 500, y: 500, hp: 100, maxHp: 100, color: '#FF4757',
          cooldownUntil: 0, siegeMode: 'idle',
          moveBudget: 50, doubleShots: 2, doubleShotPending: false, repairKits: 1,
          laserShots: 1, nukeShots: 1, tankType: 'K2' },
    enemy: { id: 'enemy', team: 'B', alive: true, x: 700, y: 500, color: '#1E90FF', tankType: 'K2' },
  },
});

console.log('\n=== canAct() 가드 ===');
test('솔로 / 자기 턴 / alive → canAct = true', () => {
  setState(baseSolo(true, true));
  if (T.canAct() !== true) throw new Error('false 반환');
});
test('솔로 / 남 턴 → canAct = false', () => {
  setState(baseSolo(true, false));
  if (T.canAct() !== false) throw new Error('true 반환');
});
test('솔로 / 자기 턴 / 죽음 → canAct = false', () => {
  setState(baseSolo(false, true));
  if (T.canAct() !== false) throw new Error('true 반환');
});
test('팀전 / alive → canAct = true (currentTurn null 무관)', () => {
  setState(baseTeam(true));
  if (T.canAct() !== true) throw new Error('false 반환 — 팀전 가드 깨짐!');
});
test('팀전 / 죽음 → canAct = false', () => {
  setState(baseTeam(false));
  if (T.canAct() !== false) throw new Error('true 반환');
});

console.log('\n=== fire() ===');
setWeapon('normal');
test('솔로 자기 턴 → socket.emit("fire")', () => {
  setState(baseSolo(true, true));
  T.fire();
  assertEmit('fire');
});
test('솔로 남 턴 → emit 안 함', () => {
  setState(baseSolo(true, false));
  T.fire();
  assertNoEmit('fire');
});
test('팀전 alive → emit 함', () => {
  setState(baseTeam(true));
  T.fire();
  assertEmit('fire', '★ v=72 회귀 검증 (팀전 발사)');
});

console.log('\n=== moveTankByDistance() (A/D 단축키 핵심) ===');
test('솔로 자기 턴 → moveBy emit', () => {
  setState(baseSolo(true, true));
  T.moveTankByDistance(-1);
  assertEmit('moveBy');
});
test('솔로 남 턴 → emit 안 함', () => {
  setState(baseSolo(true, false));
  T.moveTankByDistance(-1);
  assertNoEmit('moveBy');
});
test('팀전 alive → moveBy emit (A/D 단축키 회귀 방지)', () => {
  setState(baseTeam(true));
  T.moveTankByDistance(1);
  assertEmit('moveBy', '★ v=72 회귀 검증 (팀전 A/D 단축키)');
});

console.log('\n=== useRepair() (R 키) ===');
test('솔로 자기 턴 → repair emit', () => {
  setState(baseSolo(true, true));
  T.useRepair();
  assertEmit('repair');
});
test('팀전 alive → repair emit', () => {
  setState(baseTeam(true));
  T.useRepair();
  assertEmit('repair', '★ v=72 회귀 검증');
});

console.log('\n=== selectWeapon() (1/2/3/4 키) ===');
test('솔로 자기 턴 / normal 선택 OK', () => {
  setState(baseSolo(true, true));
  T.selectWeapon('normal');
});
test('팀전 alive / redbean 선택 OK', () => {
  setState(baseTeam(true));
  T.selectWeapon('redbean');
});

console.log('\n=== toggleDoubleShot() (X 키) ===');
test('솔로 자기 턴 → 토글', () => {
  setState(baseSolo(true, true));
  T.toggleDoubleShot();
});
test('팀전 alive → 토글 OK', () => {
  setState(baseTeam(true));
  T.toggleDoubleShot();
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
