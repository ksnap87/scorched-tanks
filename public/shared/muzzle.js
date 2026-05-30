// === 공유 포구 계산 모듈 ===
// server.js + game.js 양쪽이 동일하게 사용 → muzzle / 포신 / tilt 좌표 일치 영구 보장.
//
// Server:  const { computeMuzzle, getBarrelLen } = require('./public/shared/muzzle');
// Client:  HTML <script src="/shared/muzzle.js"> → window.SharedMuzzle.computeMuzzle(...)

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SharedMuzzle = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BARREL_LEN_BY_TANK = { K2: 26, M1A2: 24, T90: 22, LEO2: 28, T10: 20, ZTZ99: 22 };
  const TERRAIN_RESOLUTION = 2;

  // 지형 y 조회 (server terrain[] 또는 client state.terrain 동일 구조)
  function getTerrainY(terrain, x) {
    if (!terrain || !terrain.length) return null;
    const idx = Math.floor(x / TERRAIN_RESOLUTION);
    if (idx < 0) return terrain[0];
    if (idx >= terrain.length) return terrain[terrain.length - 1];
    return terrain[idx];
  }

  // 포신 길이 (시즈모드 시 1.5×)
  function getBarrelLen(tankType, siegeMode) {
    const base = BARREL_LEN_BY_TANK[tankType] || 22;
    return base * (siegeMode === 'sieged' ? 1.5 : 1.0);
  }

  // 시즈 변환 중 길이 (애니메이션) — siegeChangedAt 기준 0~4초
  function getBarrelLenAnimated(tankType, siegeMode, siegeChangedAt) {
    const base = BARREL_LEN_BY_TANK[tankType] || 22;
    const now = Date.now();
    if (siegeMode === 'sieged') return base * 1.5;
    if (siegeMode === 'idle') return base;
    if (siegeMode === 'transforming') {
      const phase = Math.min(1, (now - (siegeChangedAt || 0)) / 4000);
      return base * (1 + 0.5 * phase);
    }
    if (siegeMode === 'untransforming') {
      const phase = Math.max(0, 1 - (now - (siegeChangedAt || 0)) / 4000);
      return base * (1 + 0.5 * phase);
    }
    return base;
  }

  // 지형 기울기 (deg). 시즈모드 시 0 (수평 고정).
  function computeTiltDeg(terrain, x, siegeMode) {
    if (!terrain || !terrain.length) return 0;
    if (siegeMode === 'sieged') return 0;
    const yL = getTerrainY(terrain, x - 16);
    const yR = getTerrainY(terrain, x + 16);
    if (yL == null || yR == null) return 0;
    const tr = Math.atan2(yR - yL, 32);
    if (!Number.isFinite(tr)) return 0;
    return Math.max(-40, Math.min(40, tr * 180 / Math.PI));
  }

  // 머즐 (포구) 좌표 + 발사 방향. server / client 단일 진실.
  //   shooter: { x, y, angle, tankType, siegeMode }
  //   terrain: room.terrain 또는 state.terrain
  //   opts: { animatedBarrel: true (siege 변환 중도 길이 보간), turretOffsetY: -4 }
  function computeMuzzle(shooter, terrain, opts) {
    opts = opts || {};
    const tiltDeg = computeTiltDeg(terrain, shooter.x, shooter.siegeMode);
    const effAngle = ((shooter.angle != null ? shooter.angle : 90)) - tiltDeg;
    const rad = effAngle * Math.PI / 180;
    const barrelLen = opts.animatedBarrel
      ? getBarrelLenAnimated(shooter.tankType, shooter.siegeMode, shooter.siegeChangedAt)
      : getBarrelLen(shooter.tankType, shooter.siegeMode);
    const turretY = shooter.y + (opts.turretOffsetY != null ? opts.turretOffsetY : -4);
    return {
      x: shooter.x + Math.cos(rad) * barrelLen,
      y: turretY - Math.sin(rad) * barrelLen,
      rad,
      effAngle,
      tiltDeg,
      barrelLen,
      turretY,
      // 발사 단위 벡터 (server: 0=오른쪽, 90=위)
      dx: Math.cos(rad),
      dy: -Math.sin(rad),
    };
  }

  return {
    BARREL_LEN_BY_TANK,
    TERRAIN_RESOLUTION,
    getTerrainY,
    getBarrelLen,
    getBarrelLenAnimated,
    computeTiltDeg,
    computeMuzzle,
  };
});
