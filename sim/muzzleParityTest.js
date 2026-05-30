// === SharedMuzzle 검증 ===
// "C안"의 핵심 약속: server.js (fireLaserBeam, simulateProjectile) 와
// public/game.js (drawTankBarrel) 가 동일한 muzzle 좌표/포신 길이를 계산한다.
//
// server.js 는 require('./public/shared/muzzle')
// game.js 는 <script src="shared/muzzle.js">  → window.SharedMuzzle
// 두 곳 모두 같은 파일을 로드하므로 함수 출력은 정의상 동일.
// 본 테스트는 (1) UMD 패턴이 깨지지 않음, (2) API 시그니처/수학이 옳음을 회귀 방지한다.

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else      { fail++; console.log(`  ✗ ${label} — ${detail || ''}`); }
}

console.log('=== UMD 패턴: Node require 로드 ===');
const SM = require(path.join(__dirname, '..', 'public', 'shared', 'muzzle.js'));
check('require 가 객체 반환', SM && typeof SM === 'object');
check('computeMuzzle 함수 존재', typeof SM.computeMuzzle === 'function');
check('getBarrelLen 함수 존재', typeof SM.getBarrelLen === 'function');
check('getBarrelLenAnimated 함수 존재', typeof SM.getBarrelLenAnimated === 'function');
check('computeTiltDeg 함수 존재', typeof SM.computeTiltDeg === 'function');
check('BARREL_LEN_BY_TANK 노출', SM.BARREL_LEN_BY_TANK && SM.BARREL_LEN_BY_TANK.K2 === 26);

console.log('\n=== UMD 패턴: 브라우저 분기 코드 존재 확인 ===');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'shared', 'muzzle.js'), 'utf8');
check('module.exports 분기 있음', src.includes('module.exports = factory()'));
check('root.SharedMuzzle 분기 있음', src.includes('root.SharedMuzzle = factory()'));
check('self|this 자동 감지', src.includes("typeof self !== 'undefined'"));

console.log('\n=== getBarrelLen: 6개 탱크 × siege 1.5× ===');
['K2', 'M1A2', 'T90', 'LEO2', 'T10', 'ZTZ99'].forEach(t => {
  const idle = SM.getBarrelLen(t, 'idle');
  const sieged = SM.getBarrelLen(t, 'sieged');
  check(`${t} sieged = idle × 1.5 (idle=${idle}, sieged=${sieged})`,
    Math.abs(sieged - idle * 1.5) < 1e-9);
});

console.log('\n=== getBarrelLenAnimated: transforming 0→100% 보간 ===');
const now = Date.now();
const baseK2 = SM.getBarrelLen('K2', 'idle');
const startLen = SM.getBarrelLenAnimated('K2', 'transforming', now);             // phase ≈ 0
const midLen   = SM.getBarrelLenAnimated('K2', 'transforming', now - 2000);      // phase ≈ 0.5
const endLen   = SM.getBarrelLenAnimated('K2', 'transforming', now - 4000);      // phase = 1
check('phase 0 ≈ base', Math.abs(startLen - baseK2) < 0.1, `start=${startLen} base=${baseK2}`);
check('phase 0.5 ≈ base × 1.25', Math.abs(midLen - baseK2 * 1.25) < 0.5, `mid=${midLen}`);
check('phase 1 = base × 1.5', Math.abs(endLen - baseK2 * 1.5) < 1e-9, `end=${endLen}`);

console.log('\n=== getBarrelLenAnimated: untransforming 100%→0% 역보간 ===');
const uStart = SM.getBarrelLenAnimated('K2', 'untransforming', now);             // phase 1
const uEnd   = SM.getBarrelLenAnimated('K2', 'untransforming', now - 4000);      // phase 0
check('untransforming phase 1 ≈ base × 1.5', Math.abs(uStart - baseK2 * 1.5) < 0.1);
check('untransforming phase 0 = base', Math.abs(uEnd - baseK2) < 1e-9);

console.log('\n=== computeTiltDeg: sieged → 0 (수평 고정) ===');
const terrain = new Array(700).fill(0).map((_, i) => 400 + Math.sin(i * 0.05) * 30);
const tiltSieged = SM.computeTiltDeg(terrain, 350, 'sieged');
const tiltIdle = SM.computeTiltDeg(terrain, 350, 'idle');
check('sieged → tilt 0', tiltSieged === 0, `got ${tiltSieged}`);
check('idle → tilt ≠ 0 (지형 따라감)', Math.abs(tiltIdle) > 0.01, `got ${tiltIdle}`);
check('tilt 절댓값 ≤ 40° clamp', Math.abs(tiltIdle) <= 40);

console.log('\n=== computeMuzzle: angle / siegeMode / tankType 별 포구 좌표 ===');
// 평지 지형
const flat = new Array(700).fill(400);
const out = SM.computeMuzzle({ tankType: 'K2', x: 100, y: 380, angle: 0, siegeMode: 'idle' }, flat);
check('angle=0, idle: 포구는 탱크 우측 + base 길이만큼',
  Math.abs(out.x - (100 + 26)) < 0.01 && Math.abs(out.y - (380 - 4)) < 0.01,
  `got x=${out.x} y=${out.y}`);

const upK2 = SM.computeMuzzle({ tankType: 'K2', x: 100, y: 380, angle: 90, siegeMode: 'idle' }, flat);
check('angle=90, idle: 포구는 탱크 위쪽 + base 길이만큼',
  Math.abs(upK2.x - 100) < 0.01 && Math.abs(upK2.y - (380 - 4 - 26)) < 0.01,
  `got x=${upK2.x} y=${upK2.y}`);

const upK2Siege = SM.computeMuzzle({ tankType: 'K2', x: 100, y: 380, angle: 90, siegeMode: 'sieged' }, flat);
check('angle=90, sieged: 포구는 위쪽 + base×1.5 (LEO2 레이저 버그 회귀 방지)',
  Math.abs(upK2Siege.x - 100) < 0.01 && Math.abs(upK2Siege.y - (380 - 4 - 26 * 1.5)) < 0.01,
  `got x=${upK2Siege.x} y=${upK2Siege.y}`);

// dx/dy 발사 벡터
const v = SM.computeMuzzle({ tankType: 'K2', x: 100, y: 380, angle: 45, siegeMode: 'idle' }, flat);
check('angle=45 발사 벡터 dx=cos45, dy=-sin45',
  Math.abs(v.dx - Math.cos(Math.PI / 4)) < 1e-9 &&
  Math.abs(v.dy - (-Math.sin(Math.PI / 4))) < 1e-9);

console.log('\n=== 핵심: LEO2 시즈 레이저 시작점 (이전 버그 회귀 방지) ===');
const leoIdle = SM.computeMuzzle({ tankType: 'LEO2', x: 500, y: 400, angle: 45, siegeMode: 'idle' }, flat);
const leoSiege = SM.computeMuzzle({ tankType: 'LEO2', x: 500, y: 400, angle: 45, siegeMode: 'sieged' }, flat);
const distIdle = Math.hypot(leoIdle.x - 500, leoIdle.y - 396);
const distSiege = Math.hypot(leoSiege.x - 500, leoSiege.y - 396);
check('LEO2 idle 포구 거리 = base 28',
  Math.abs(distIdle - 28) < 0.01, `dist=${distIdle}`);
check('LEO2 sieged 포구 거리 = base × 1.5 = 42 (서버/클라 동일 필수)',
  Math.abs(distSiege - 42) < 0.01, `dist=${distSiege}`);

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
