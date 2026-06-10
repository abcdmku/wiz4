// game.js - the engine: 30ms fixed tick, quarter-pixel velocities,
// tile probes, pixel-mask collision, window camera, and spell ladder.
'use strict';

(() => {
  const TS = 16, MAPW = 256, MAPH = 16;
  const TICK = 30;
  const SPELL_COST = 24;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /* --------------------------------- save --------------------------------- */
  const SAVE_KEY = 'wiz4.v1';
  function loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
  }
  function store(patch) {
    const s = Object.assign(loadSave(), patch);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  /* --------------------------------- input -------------------------------- */
  const DEFAULT_KEYS = { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown', j: 'Space', p: 'KeyP' };
  const Joy = {
    keys: Object.assign({}, DEFAULT_KEYS, loadSave().keys || {}),
    left: false, right: false, up: false, down: false, fire: false,
    upHeld: false, fireHeld: false, downEdge: false,
    rebind: null, // {step, names, codes}
  };
  const KEY_LABEL = (code) => code.replace(/^Key|^Arrow|^Digit/, '').replace('ControlLeft', 'CTRL').toUpperCase();

  window.addEventListener('keydown', (e) => {
    SFX.ensure();
    if (Joy.rebind) {
      if (e.code === 'Escape') { Joy.rebind = null; }
      else {
        Joy.rebind.codes.push(e.code);
        if (Joy.rebind.codes.length === 6) {
          const c = Joy.rebind.codes;
          Joy.keys = { l: c[0], r: c[1], u: c[2], d: c[3], j: c[4], p: c[5] };
          store({ keys: Joy.keys });
          Joy.rebind = null;
        } else Joy.rebind.step++;
      }
      e.preventDefault(); return;
    }
    const k = Joy.keys;
    if (e.code === k.l) Joy.left = true;
    else if (e.code === k.r) Joy.right = true;
    else if (e.code === k.u) { if (!Joy.upHeld) { Joy.up = true; Joy.upHeld = true; } }
    else if (e.code === k.d) Joy.down = true;
    else if (e.code === k.j || e.code === 'ControlLeft' || e.code === 'ControlRight') {
      if (!Joy.fireHeld) { Joy.fire = true; Joy.fireHeld = true; }
    }
    else if (e.code === k.p) { game.togglePause(); }
    else if (e.code === 'KeyM') { const m = SFX.toggleMute(); store({ muted: m }); }
    else if (e.code === 'F2' && game.state === 'playing') {
      Joy.rebind = { step: 0, names: ['LEFT', 'RIGHT', 'UP', 'DOWN', 'JUMP', 'PAUSE'], codes: [] };
    }
    else if (e.code === 'KeyS' && (game.state === 'intro' || game.state === 'gameover')) game.newGame();
    else if (e.code === 'KeyR' && (game.state === 'intro' || game.state === 'gameover')) game.resumeGame();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = Joy.keys;
    if (e.code === k.l) Joy.left = false;
    else if (e.code === k.r) Joy.right = false;
    else if (e.code === k.u) { Joy.up = false; Joy.upHeld = false; }
    else if (e.code === k.d) { Joy.down = false; Joy.downEdge = false; }
    else if (e.code === k.j || e.code === 'ControlLeft' || e.code === 'ControlRight') { Joy.fire = false; Joy.fireHeld = false; }
  });
  window.addEventListener('blur', () => { if (game.state === 'playing') game.lostFocus = true; });
  window.addEventListener('focus', () => { game.lostFocus = false; });
  canvas.addEventListener('mousedown', () => { SFX.ensure(); game.lostFocus = false; });
  if (loadSave().muted) SFX.setMuted(true);

  /* --------------------------------- score -------------------------------- */
  const S = {
    score: 0, hiscore: loadSave().hiscore || 0, lives: 3,
    potions: 0, spells: 0, key: false,
    invincible: 0, invisible: false, asbestos: false, restore: false,
    maxJumps: 1, highJump: -36,
    reset() {
      this.score = 0; this.lives = 3; this.potions = 0; this.key = false;
      this.invincible = 0; this.resetSpells(); this.restore = false;
    },
    resetSpells() {
      this.spells = 0; this.maxJumps = 1; this.highJump = -36;
      this.invisible = false; this.asbestos = false;
    },
    restoreSpells() {
      this.spells = 5; this.maxJumps = 2; this.highJump = -40;
      this.invisible = true; this.asbestos = true; this.restore = false;
    },
    nextSpell(x, y) {
      this.spells++;
      if (this.spells === 1) this.highJump = -40;
      else if (this.spells === 2) this.invisible = true;
      else if (this.spells === 3) this.maxJumps = 2;
      else if (this.spells === 4) this.asbestos = true;
      else if (this.spells === 5) game.createBob(16, 0, 0, 0, 0, 0);
      else if (this.spells === 6) this.restore = true;
      else { this.spells = 6; this.extraLife(x, y); }
    },
    extraLife(x, y) {
      this.lives++;
      SFX.play('extra');
      game.createBob(10, x, y, 0, 0, 2);
      game.createBob(12, 0, 0, 0, 0, 0);
    },
    add(n) { this.score += n; if (this.score > this.hiscore) this.hiscore = this.score; },
  };

  /* --------------------------------- bobs ---------------------------------- */
  class Bob {
    constructor(type, x, y, sx, sy, flag) {
      this.type = type; this.flag = flag;
      this.start = { x: sx, y: sy };
      this.sheet = null; this.a = 0; this.touch = 0; this.alive = true;
      this.dyy = -16; // dying arc
      this.r = { x, y, w: 16, h: 16 };
    }
    setSheet(sheet, w) {
      this.sheet = sheet;
      this.r.w = w || sheet.fw;
      this.r.h = sheet.fh;
      this.r.y -= sheet.fh; // spawn feet at cell bottom
    }
    dieFall() { this.r.y += (this.dyy / 2) | 0; this.dyy++; }
    move() { this.dieFall(); }
    draw(c, ox) { this.sheet.draw(c, this.a, this.r.x - ox, this.r.y); }
    mask() { return this.sheet.mask(this.a); }
    outOfBounds(lx) {
      return this.r.x - lx < -512 || this.r.x - lx > 1023 || this.r.y > 256;
    }
  }

  class Guard extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.guard, 16); this.touch = 1; this.aa = 0; this.xx = -1; this.yy = 0; }
    move() {
      if (!this.alive) return this.dieFall();
      if (!game.blockAt(this.r.x + 8 - this.xx * 4, this.r.y + this.r.h, 3)) {
        if (this.yy < 16) this.yy++;
        this.r.y += this.yy >> 2;
      } else {
        this.r.y = ((this.r.y + this.r.h) & ~15) - this.r.h;
        this.yy = 0;
        this.r.x += this.xx;
      }
      if (game.blockAt(this.r.x + 8 + this.xx * 8, this.r.y + this.r.h - 1, 1)) this.xx = -this.xx;
      this.a = ((this.aa++ & 4) >> 2) | (this.xx & 2);
    }
  }

  class Sentry extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.sentry, 16); this.touch = 1; this.aa = 0; this.xx = -1; }
    move() {
      if (!this.alive) return this.dieFall();
      if (!game.blockAt(this.r.x + 8 + this.xx * 8, this.r.y + this.r.h, 3) ||
          game.blockAt(this.r.x + 8 + this.xx * 8, this.r.y + this.r.h - 1, 1)) this.xx = -this.xx;
      this.r.x += this.xx;
      this.a = ((this.aa++ & 4) >> 2) | (this.xx & 2);
    }
  }

  class Knight extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.knight, 16); this.touch = 1; this.aa = 0; }
    move() { if (!this.alive) return this.dieFall(); this.a = ((this.aa++ & 0x18) / 24) | 0; }
  }

  class Archer extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.archer, 16); this.touch = 1; this.c = 48; }
    move() {
      if (!this.alive) return this.dieFall();
      this.c++;
      const p = game.player;
      if (this.c === 56) this.a = (p && p.r.x > this.r.x) ? 3 : 1;
      if (this.c === 64) {
        this.a &= ~1; this.c = 0;
        game.createBob(4, this.r.x + (this.a & 2) * 4 - 4, this.r.y + 12 + SPRITES.arrow.fh, 0, 0, this.a & 2);
      }
    }
  }

  class Arrow extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.arrow, 16); this.touch = 1; this.h = false; this.yy = -4; this.d = this.flag ? 4 : 0; this.xx = this.d * 2 - 4; }
    move() {
      if (!this.alive) return this.dieFall();
      this.a = (++this.a & 3) | this.d;
      if (game.blockAt(this.r.x + 8 + this.xx, this.r.y, 1)) { this.h = true; this.touch = 0; }
      if (!this.h) this.r.x += this.xx;
      else { this.r.x -= (this.xx / 2) | 0; this.r.y += this.yy; this.yy++; }
    }
  }

  class Ghost extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.ghost, 16); this.touch = 1; this.xx = 0; this.yy = 0; this.aa = 0; }
    move() {
      if (!this.alive) return this.dieFall();
      const p = game.player;
      if (p && this.r.y < p.r.y && this.yy < 16) {
        this.yy++;
        if (this.r.x < p.r.x && this.xx < 16) this.xx++;
        else if (this.xx > -16) this.xx--;
      } else if (this.yy > -16) {
        this.yy--;
        this.xx = this.xx < 0 ? -8 : 8;
      }
      this.r.x += (this.xx / 8) | 0;
      this.r.y += (this.yy / 8) | 0;
      this.aa = (this.aa + 1) & 7;
      this.a = (this.xx < 0 ? 0 : 2) + ((this.aa / 4) | 0);
    }
  }

  class Dragon extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.dragon, 32); this.touch = 1; this.aa = 0; this.c = 0; this.yy = 0; }
    move() {
      if (!this.alive) return this.dieFall();
      this.a = (this.aa++ & 0xC) >> 2;
      if (game.blockAt(this.r.x, this.r.y + this.r.h, 3)) this.yy = 0;
      this.c++;
      if (this.c % 50 === 0) {
        this.yy = -19;
        if (this.c === 200) { this.c = 0; this.yy = -25; }
      }
      if (this.yy !== 0) this.yy += 2;
      this.r.y += (this.yy / 2) | 0;
    }
  }

  class Fish extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.fish, 16); this.touch = 1; this.r.y = 320; this.yy = -16; }
    move() {
      if (!this.alive) return this.dieFall();
      this.r.y += (this.yy / 2) | 0; this.yy++;
      if (this.r.y > 320) this.yy = -28;
      this.a = (this.yy > 0 ? 2 : 0) + (this.yy & 1);
    }
    outOfBounds(lx) { return this.r.x - lx < -16 || this.r.x - lx > 512 || this.r.y > 512; }
  }

  class Boulder extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.boulder, 16); this.touch = 1; this.r.y -= 256; this.yy = 0; this.c = 0; this.aa = 0; }
    move() {
      if (!this.alive) return this.dieFall();
      if (game.blockAt(this.r.x, this.r.y + this.r.h, 3) &&
          !game.blockAt(this.r.x, this.r.y + this.r.h - 16, 3) && this.r.y > this.c) {
        this.r.y &= ~15;
        this.c = this.r.y + 16;
        this.yy = -16;
      }
      if (this.yy < 16) this.yy += 2;
      this.r.y += this.yy >> 2;
      if (this.r.y > 256) { this.r.y = -64; this.c = 0; }
      this.a = (this.aa++ & 6) >> 1;
    }
    outOfBounds(lx) { return this.r.x - lx < -16 || this.r.x - lx > 512 || this.r.y > 512; }
  }

  class FireBed extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.fire, 32); this.touch = 2; }
    move() { this.a = (this.a + 1) & 3; }
  }

  class FlameJet extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.flame, 16); this.touch = 2; this.aa = (Math.random() * 64) | 0; }
    move() { this.aa++; this.a = ((this.aa & 0x20) / 16) + (this.aa & 1); }
  }

  class Fireball extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.fireball, 16); this.touch = 2; this.xx = -2; this.yy = this.flag; }
    move() {
      if (!game.blockAt(this.r.x + 8, this.r.y + this.r.h, 3)) {
        if (this.yy < 14) this.yy += 2;
        this.r.y += this.yy >> 2;
        this.r.x += this.xx;
      } else {
        this.r.y = ((this.r.y + this.r.h) & ~15) - this.r.h;
        this.yy = 1;
        this.r.x += this.xx;
      }
      if (game.blockAt(this.r.x + 8 + this.xx * 4, this.r.y + this.r.h - this.yy, 1)) this.xx = -this.xx;
      this.a = (this.a + 1) & 3;
    }
  }

  class Helper extends Bob {
    constructor(...a) {
      super(...a); this.setSheet(SPRITES.helper, 16); this.touch = 0;
      this.xx = 0; this.yy = 0; this.bi = 0; this.target = null;
    }
    move() {
      const home = this.target && this.target.alive ? this.target : game.player;
      if (this.r.x < home.r.x && this.xx < 16) this.xx++;
      else if (this.xx > -16) this.xx--;
      if (this.r.y < home.r.y - 4 && this.yy < 12) this.yy++;
      else if (this.yy > -12) this.yy--;
      this.r.x += (this.xx / 4) | 0;
      this.r.y += (this.yy / 4) | 0;
      this.a = (this.a + 1) & 3;
      const lx = game.cam.lx;
      if (!this.target) {
        this.bi = (this.bi + 1) % game.bobs.length;
        const b = game.bobs[this.bi];
        if (b && b.touch === 1 && b.alive && b.r.x > lx && b.r.x < lx + 480) this.target = b;
      } else {
        const t = this.target;
        if (!t.alive || t.touch !== 1 || t.r.x < lx - 32 || t.r.x > lx + 512 || t.r.y > 248) { this.target = null; return; }
        if (rectsOverlap(this.r, t.r)) {
          this.xx = 0; this.yy = 0;
          S.add(500);
          t.touch = 0; t.alive = false;
          if (t.type === 20 || t.type === 22) { // banishing a boss head fells the chain
            for (const b of game.bobs) if (b.type === t.type) { b.alive = false; b.touch = 0; }
          }
          SFX.play('banish');
          this.target = null;
        }
      }
    }
    outOfBounds() { return false; }
  }

  class StarFx extends Bob {
    constructor(...a) {
      super(...a); this.setSheet(SPRITES.star, 16); this.touch = 0;
      const D = [[0, -8], [0, -24], [16, -16], [24, 0], [16, 16], [0, 24], [-16, 16], [-24, 0], [-16, -16]];
      [this.xx, this.yy] = D[Math.min(this.flag, 8)];
      this.life = 0;
    }
    move() {
      this.a = (this.a + 1) & 7;
      this.r.x += this.xx >> 2; this.r.y += this.yy >> 2;
      this.yy++; this.life++;
    }
    outOfBounds(lx) { return this.life > 48 || this.r.y > 256; }
  }

  class BottleFx extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.bottle, 16); this.touch = 0; this.yy = -8; this.life = 0; }
    move() { this.a = (this.a + 1) & 7; this.r.y += this.yy; this.yy++; this.r.x--; this.life++; }
    outOfBounds() { return this.life > 40; }
  }

  class GlitterFx extends Bob {
    constructor(...a) { super(...a); this.setSheet(SPRITES.glitter, 32); this.touch = 0; this.c = 0; }
    move() {
      const p = game.player;
      if (p) { this.r.x = p.r.x - 8; this.r.y = p.r.y - 8; }
      this.c++;
      this.a = ((this.c / 2) | 0) & 3;
    }
    outOfBounds() { return this.c > 32; }
  }

  class MiscFx extends Bob {
    constructor(type, x, y, sx, sy, flag) {
      super(type, x, y, sx, sy, flag);
      this.sheet = SPRITES.misc[Math.min(flag, 5)];
      this.r.w = 16; this.r.h = 16; this.r.y -= 16;
      this.touch = 0; this.c = 0;
    }
    move() { this.c++; if (this.flag > 0) this.r.y--; this.a = (this.c >> 2) & 1; }
    outOfBounds() { return this.c > 32 || (this.flag === 0 && this.c > 7); }
  }

  class Platform extends Bob {
    constructor(type, x, y, sx, sy, flag, sheet) {
      super(type, x, y, sx, sy, flag);
      this.setSheet(sheet, 32);
      this.touch = 4; this.on = false;
      this.ii = flag < 0 ? -2 : 2;
      this.c = this.per = Math.abs(flag) / 2 | 0;
      this.xx = 0; this.yy = 0;
    }
    outOfBounds(lx) { return this.r.x - lx < -512 || this.r.x - lx > 1023 || this.r.y > 256; }
  }
  class VPlat extends Platform {
    constructor(t, x, y, sx, sy, fl) { super(t, x, y, sx, sy, fl, SPRITES.vplat); this.yy = this.ii; }
    move() {
      if (--this.c < 0) { this.yy = -this.yy; this.c = this.per; }
      if (this.r.y >= 256) { this.r.y = -16; this.c = this.per; }
      this.r.y += this.yy;
    }
  }
  class HPlat extends Platform {
    constructor(t, x, y, sx, sy, fl) {
      super(t, x, y, sx, sy, fl, SPRITES.hplat);
      this.xx = this.ii; this.x1 = this.xx < 0 ? -1 : 1;
    }
    move() {
      if (--this.c < 0 || game.blockAt(this.r.x - 16, this.r.y, 1) ||
          game.blockAt(this.r.x + this.r.w + 16, this.r.y, 1)) { this.x1 = -this.x1; this.c = this.per; }
      if ((this.xx > -8 && this.x1 < 0) || (this.xx < 8 && this.x1 > 0)) this.xx += this.x1;
      this.r.x += (this.xx / 4) | 0;
    }
  }
  class FPlat extends Platform {
    constructor(t, x, y, sx, sy, fl) { super(t, x, y, sx, sy, fl, SPRITES.fplat); this.ii = 0; this.yy = 0; }
    move() {
      this.yy = (this.ii / 8) | 0;
      this.r.y += this.yy;
      if (this.on) {
        this.ii++;
        if (this.ii === 8) SFX.play('fall');
      }
    }
  }

  class Boss extends Bob { // moon serpent: swooping head + anchored coils
    constructor(type, x, y, sx, sy, flag) {
      super(type, x, y, sx, sy, flag);
      this.setSheet(SPRITES.boss, 64);
      this.r.y += 16;
      this.bx = this.r.x; this.by = this.r.y;
      this.yy = 16; this.y1 = 1; this.xx = 8; this.x1 = 1; this.c = 0;
      if (flag > 0) { this.touch = 0; this.a = 1; }
      else { Boss.sx = this.r.x; Boss.sy = this.r.y; this.touch = 1; this.a = 0; }
      if (flag < 8) game.createBob(20, x, y, 0, 0, flag + 1);
    }
    move() {
      if (!this.alive) return this.dieFall();
      if (++this.c < 8) return;
      if (this.flag === 0) {
        this.x1 = this.r.x > this.bx ? -1 : 1;
        this.y1 = this.r.y > this.by - 48 ? -1 : 1;
        if (this.r.y > 224 && this.c > 14) {
          game.createBob(13, this.r.x, this.r.y + 16 + SPRITES.fireball.fh, 0, 0, -32);
          this.c = 8;
        }
        this.xx += this.x1; this.yy += this.y1;
        this.r.x += (this.xx / 4) | 0;
        this.r.y += (this.yy / 4) | 0;
        Boss.sx = this.r.x; Boss.sy = this.r.y;
      } else {
        this.r.x = Boss.sx + (((this.bx - Boss.sx) * this.flag / 8) | 0);
        this.r.y = Boss.sy + (((this.by - Boss.sy) * this.flag / 8) | 0);
      }
    }
  }

  class Boss2 extends Bob { // ember wyrm: triangle-wave sweeps, tail pinned
    constructor(type, x, y, sx, sy, flag) {
      super(type, x, y, sx, sy, flag);
      this.setSheet(SPRITES.boss2, 64);
      this.yy = 0; this.y1 = -1; this.xx = -24; this.x1 = -1; this.c = 0;
      if (flag > 0) { Boss2.oob = false; this.a = 1; this.touch = 0; }
      else { Boss2.sx = this.r.x; Boss2.sy = this.r.y; this.a = 0; this.touch = 1; }
      if (flag < 8) game.createBob(22, x, y - 16, 0, 0, flag + 1);
      else { Boss2.ex = this.r.x; Boss2.ey = this.r.y; }
    }
    move() {
      if (!this.alive) return this.dieFall();
      if (++this.c < 8) return;
      if (this.flag === 0) {
        if (this.xx === 24) this.x1 = -1;
        if (this.xx === -24) this.x1 = 1;
        if (this.yy === 12) this.y1 = -1;
        if (this.yy === -12) this.y1 = 1;
        this.xx += this.x1; this.yy += this.y1;
        this.r.x += (this.xx / 4) | 0;
        this.r.y += (this.yy / 4) | 0;
        Boss2.sx = this.r.x; Boss2.sy = this.r.y;
      } else {
        this.r.x = Boss2.sx + (((Boss2.ex - Boss2.sx) * this.flag / 8) | 0);
        this.r.y = Boss2.sy + (((Boss2.ey - Boss2.sy) * this.flag / 8) | 0);
      }
    }
    outOfBounds(lx) {
      if (this.r.x - lx < -96 || this.r.x - lx > 544) Boss2.oob = true;
      return Boss2.oob;
    }
  }

  /* --------------------------------- player -------------------------------- */
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  class Wiz extends Bob {
    constructor() {
      super(0, 0, 0, 0, 0, 0);
      this.setSheet(SPRITES.wiz, 16);
      this.xx = 0; this.yy = 0; this.aa = 0; this.j1 = 0; this.px = 0;
      this.platform = null; this.switchFlag = false; this.a = 8;
      const s = game.getStart(game.checkPoint, game.startX);
      this.r.x = s.x; this.r.y = s.y - this.r.h;
      this.leftBound = game.cam.leftBound + 16;
      this.rightBound = game.cam.rightBound + 480;
      this.a = ((this.rightBound - this.leftBound) / 2 + this.leftBound < this.r.x) ? 24 : 8;
      if (game.wasDead) {
        S.lives--;
        if (S.restore) { SFX.play('powerup'); S.restoreSpells(); }
      }
      if (S.spells > 4) game.createBob(16, 0, 0, 0, 0, 0);
    }

    get ducking() { return this.alive && (this.a & 15) === 10; }
    get hiddenInvisible() { return this.alive && (this.a & 15) === 13; }

    move() {
      if (!this.alive) {
        this.dieFall();
        if (this.r.y > 255) { game.wasDead = true; game.beginRestart(); }
        return;
      }
      if (S.invincible > 0) S.invincible--;

      if (!Joy.right && !Joy.left) this.a = (this.a & 16) + 8;
      if (Joy.down) {
        Joy.left = Joy.right = false;
        this.xx = this.px;
        if (S.invisible) {
          this.a = 13;
          if (!Joy.downEdge) { game.createBob(12, 0, 0, 0, 0, 0); Joy.downEdge = true; }
        } else this.a = (this.a & 16) + 10;
      }
      if (Joy.right) { this.aa++; this.a = this.aa & 7; this.xx = Math.min(this.xx + 2, 16); }
      else if (Joy.left) { this.aa--; this.a = (this.aa & 7) + 16; this.xx = Math.max(this.xx - 2, -16); }

      if (Joy.fire && this.j1 < S.maxJumps && (this.yy & ~7) === 0) {
        this.yy = S.highJump;
        Joy.fire = false;
        this.j1++;
        SFX.play('jump');
      }

      // horizontal move + wall probes
      this.r.x += (this.xx / 4) | 0;
      this.r.x = Math.min(Math.max(this.r.x, this.leftBound), this.rightBound);
      let tl = (this.r.x + 4) >> 4, tr = (this.r.x + 11) >> 4;
      let tt = Math.max(this.r.y >> 4, 0);
      let tm = Math.max((this.r.y + 16) >> 4, 0);
      let tb = Math.max((this.r.y + 23) >> 4, 0);
      if (this.xx < this.px) {
        this.xx++;
        if ((game.blk(tl, tt) | game.blk(tl, tm) | game.blk(tl, tb)) & 1) {
          this.r.x = (this.r.x & ~15) + 12; this.xx = -3;
        }
        if (!Joy.left) this.a = 27;
      } else if (this.xx > this.px) {
        this.xx--;
        if ((game.blk(tr, tt) | game.blk(tr, tm) | game.blk(tr, tb)) & 1) {
          this.r.x = (this.r.x & ~15) + 4; this.xx = 3;
        }
        if (!Joy.right) this.a = 11;
      }

      // vertical
      const oldy = this.r.y;
      const tbb = tb;
      if (this.yy < 48) this.yy += 2;
      this.r.y += (this.yy / 4) | 0;
      if (this.r.y > 232) { this.r.y = 232; this.die(); return; }
      tl = (this.r.x + 4) >> 4; tr = (this.r.x + 11) >> 4;
      tt = Math.max(this.r.y >> 4, 0);
      tm = Math.max((this.r.y + 16) >> 4, 0);
      tb = Math.max((this.r.y + 23) >> 4, 0);
      if ((game.blk(tl, tt) | game.blk(tr, tt)) & 1) { // ceiling
        this.r.y = (this.r.y & ~15) + 16;
        this.yy = 4;
      }
      if (((game.blk(tl, tb) | game.blk(tr, tb)) & 3) && tb > tbb) { // landing
        this.j1 = 0;
        this.r.y = ((this.r.y + 24) & ~15) - 24;
        this.yy = 4;
        this.platform = null;
        const bl = game.cell(tl, tb), br = game.cell(tr, tb);
        if (bl && bl.bonus === 10) this.springAt(tl, tb);
        else if (br && br.bonus === 10) this.springAt(tr, tb);
      } else if (this.platform) {
        const p = this.platform;
        if (this.yy < 0 || this.r.x + this.r.w <= p.r.x || this.r.x >= p.r.x + p.r.w - 1) {
          this.platform = null;
        } else {
          this.r.y = oldy + p.yy;
          if (this.r.y > 232) { this.r.y = 232; this.die(); return; }
          this.px = p.xx;
          this.j1 = 0;
          this.yy = 4;
        }
      } else {
        this.a = (this.a & 16) + 9; // airborne
        this.px = 0;
      }

      // bob collisions
      const hit = this.hitAnyBob();
      if (hit.b) {
        if (hit.t === 1 || (hit.t === 2 && !S.asbestos)) this.checkDie();
        else if (hit.t === 4) {
          const p = hit.b;
          if (p.r.y + 4 > oldy + this.r.h) {
            p.on = true;
            this.platform = p;
            this.r.y = p.r.y - this.r.h;
          }
        }
      }

      // bonus tiles at body centre
      const cx = (this.r.x + 8) >> 4;
      let cy = Math.max((this.r.y + 7) >> 4, 0);
      const c1 = game.cell(cx, cy), c2 = game.cell(cx, cy + 1);
      let hitSwitch = false;
      if ((c1 && c1.bonus > 0) || (c2 && c2.bonus > 0)) {
        if (c2 && c2.bonus > 0) cy++;
        const cell = game.cell(cx, cy);
        switch (cell.bonus) {
          case 2: { // potion
            SFX.play('bottle');
            S.potions++; S.add(100);
            game.createBob(8, cx * 16, cy * 16 + 16, 0, 0, 0);
            if (S.potions % SPELL_COST === 0) {
              for (let i = 1; i < 9; i++) game.createBob(5, this.r.x, this.r.y + 4 + 16, 0, 0, i);
              game.createBob(12, 0, 0, 0, 0, 0);
              SFX.play('powerup');
              S.nextSpell(cx * 16, cy * 16 + 16);
            }
            game.clearBonus(cx, cy);
            break;
          }
          case 1: // star
            SFX.play('star'); S.add(1000);
            game.createBob(5, cx * 16, cy * 16 + 16, 0, 0, 0);
            game.clearBonus(cx, cy);
            break;
          case 6: // invincibility orb
            S.invincible = 1000;
            SFX.play('powerup');
            game.createBob(10, cx * 16, cy * 16 + 16, 0, 0, 3);
            game.createBob(12, 0, 0, 0, 0, 0);
            game.clearBonus(cx, cy);
            break;
          case 4: // key
            SFX.play('key'); S.add(1000); S.key = true;
            game.keyCell = { x: cx, y: cy };
            game.createBob(10, cx * 16, cy * 16 + 16, 0, 0, 1);
            game.clearBonus(cx, cy);
            break;
          case 3: // extra life
            S.extraLife(cx * 16, cy * 16 + 16);
            game.clearBonus(cx, cy);
            break;
          case 5: { // checkpoint waystone
            SFX.play('checkpoint');
            game.checkPoint = 1;
            game.clearCP();
            cell.cp = 1;
            game.startX = cx;
            game.createBob(10, cx * 16, cy * 16 + 16, 0, 0, 5);
            game.clearBonus(cx, cy, true);
            break;
          }
          case 7: { // doorway
            if (Joy.up) {
              Joy.up = false;
              this.xx = 0;
              if (!cell.locked || S.key) {
                if (cell.locked) { S.key = false; game.keyCell = null; }
                SFX.play('door');
                game.enterDoor(cx, cy, cell.cp);
              } else {
                SFX.play('nokey');
                game.createBob(10, cx * 16, cy * 16 + 16, 0, 0, 4);
              }
            }
            break;
          }
          case 8: // lever
            if (!this.switchFlag) {
              SFX.play('lever');
              game.throwSwitch();
              this.switchFlag = true;
            }
            hitSwitch = true;
            break;
          case 9: // end of level
            game.nextLevel = true;
            SFX.play('door');
            game.beginRestart();
            break;
        }
      }
      if (!hitSwitch) this.switchFlag = false;
    }

    springAt(tx, ty) {
      this.yy = -42;
      this.j1++;
      game.createBob(10, tx * 16, ty * 16 + 4 + 16, 0, 0, 0);
      SFX.play('bounce');
    }

    hitAnyBob() {
      let best = { b: null, t: 0 };
      if (this.hiddenInvisible) return best;
      const myMask = this.mask();
      for (let i = 1; i < game.bobs.length; i++) {
        const b = game.bobs[i];
        if (!b.touch || !rectsOverlap(this.r, b.r)) continue;
        if (b.touch > best.t && this.maskOverlap(myMask, b)) best = { b, t: b.touch };
      }
      return best;
    }

    maskOverlap(myMask, b) {
      const bm = b.mask();
      const x0 = Math.max(this.r.x, b.r.x), x1 = Math.min(this.r.x + this.r.w, b.r.x + b.r.w);
      const y0 = Math.max(this.r.y, b.r.y), y1 = Math.min(this.r.y + this.r.h, b.r.y + b.r.h);
      for (let y = y0; y < y1; y++) {
        const myRow = (y - this.r.y) * this.r.w - this.r.x;
        const bRow = (y - b.r.y) * b.r.w - b.r.x;
        for (let x = x0; x < x1; x++) {
          if (myMask[myRow + x] && bm[bRow + x]) return true;
        }
      }
      return false;
    }

    checkDie() {
      if (game.god) return;
      if (S.invincible > 80) { S.invincible = 80; SFX.play('hit'); return; }
      if (S.invincible > 0) return;
      this.die();
    }

    die() {
      SFX.play('die');
      this.xx = -this.xx;
      this.alive = false;
      this.dyy = -16;
      this.a = (this.a & 16) + 12;
      game.freeze = 16;
      if (S.key) {
        game.createBob(10, this.r.x, this.r.y + 16, 0, 0, 1);
        if (game.keyCell) { // return the key to its spawn point after death
          game.cell(game.keyCell.x, game.keyCell.y).bonus = 4;
          game.keyCell = null;
        }
      }
      S.key = false;
      S.resetSpells();
    }

    draw(c, ox) {
      if (this.hiddenInvisible) {
        c.globalAlpha = 0.5;
        this.sheet.draw(c, this.a, this.r.x - ox, this.r.y);
        c.globalAlpha = 1;
        return;
      }
      const flicker = S.invincible > 0 && ((S.invincible & 2) === 0 || S.invincible >= 80);
      this.sheet.draw(c, this.a, this.r.x - ox, this.r.y);
      if (flicker) {
        c.save();
        c.globalAlpha = S.invincible >= 80 ? 0.45 : 0.6;
        c.globalCompositeOperation = 'lighter';
        this.sheet.draw(c, this.a, this.r.x - ox, this.r.y);
        c.restore();
      }
    }
    outOfBounds() { return false; }
  }

  /* --------------------------------- game ---------------------------------- */
  const FACTORY = {
    0: Wiz, 1: Guard, 2: Knight, 3: Dragon, 4: Arrow, 5: StarFx, 6: VPlat, 7: HPlat,
    8: BottleFx, 9: FireBed, 10: MiscFx, 11: Sentry, 12: GlitterFx, 13: Fireball,
    14: FlameJet, 15: Boulder, 16: Helper, 17: FPlat, 18: Fish, 19: Archer,
    20: Boss, 21: Ghost, 22: Boss2,
  };

  const game = {
    state: 'intro',          // intro | playing | paused | gameover
    level: 1, land: null, bobs: [], player: null,
    cam: { lx: 0, leftBound: 0, rightBound: MAPW * 16 - 513 },
    fade: 0, freeze: 0, tick: 0,
    checkPoint: 1, startX: 0, wasDead: false, nextLevel: false, restarting: false,
    leverFlip: 0, keyCell: null, lostFocus: false, god: false,
    levelCardT: 0,

    cell(x, y) {
      if (x < 0 || x >= MAPW || y < 0 || y >= MAPH) return null;
      return this.land.cells[x][y];
    },
    blk(tx, ty) {
      const c = this.cell(tx, Math.min(ty, MAPH - 1));
      return c ? c.block : 0;
    },
    blockAt(px, py, type) {
      if (py > 255 || py < 0) return false;
      const c = this.cell(px >> 4, py >> 4);
      return !!(c && (c.block & type));
    },

    loadLevel(n) {
      this.level = n;
      this.land = compileLevel(LEVELS[(n - 1) % LEVELS.length]);
      this.leverFlip = 0;
      this.keyCell = null;
      this.checkPoint = 1;
      this.startX = this.land.start ? this.land.start.x : 0;
      Boss2.oob = false;
      this.levelCardT = 90;
    },

    newGame() {
      S.reset();
      this.level = 1;
      this.beginPlay();
    },
    resumeGame() {
      const sv = loadSave();
      S.reset();
      S.score = sv.score || 0;
      this.level = Math.max(1, Math.min(sv.level || 1, LEVELS.length));
      this.beginPlay();
    },
    beginPlay() {
      this.loadLevel(this.level);
      this.wasDead = false;
      this.nextLevel = false;
      this.initBobs();
      this.state = 'playing';
      this.fade = 128;
    },

    initBobs() {
      this.bobs = [null]; // slot 0 reserved for the player
      for (const col of this.land.cells) for (const c of col) c.spawned = false;
      Boss2.oob = false;
      this.player = new Wiz();
      this.bobs[0] = this.player;
      this.createBob(12, 0, 0, 0, 0, 0);
      const lo = this.cam.lx >> 4;
      for (let x = lo; x < Math.min(lo + 32, MAPW); x++) this.spawnColumn(x);
      this.prevLo = (this.cam.lx >> 4) - 1;
      this.prevHi = ((this.cam.lx + 512) >> 4) + 1;
      this.fade = 128;
      this.wasDead = false;
      this.nextLevel = false;
    },

    createBob(type, x, y, sx, sy, flag) {
      const Cls = FACTORY[type];
      if (!Cls) return;
      const b = type === 0 ? this.player : new Cls(type, x, y, sx, sy, flag);
      if (type !== 0) this.bobs.push(b);
      return b;
    },

    spawnColumn(x) {
      if (x < 0 || x >= MAPW) return;
      for (let y = 0; y < MAPH; y++) {
        const c = this.land.cells[x][y];
        if (c.sprite > 0 && !c.spawned) {
          c.spawned = true;
          this.createBob(c.sprite, x * 16, y * 16 + 16, x, y, c.sflag);
        }
      }
    },

    getStart(cp, startX) {
      let xs = startX & 0xFF;
      for (let i = 0; i < MAPW; i++) {
        for (let y = MAPH - 1; y >= 0; y--) {
          const c = this.land.cells[xs][y];
          if (c.cp === cp && c.sprite === 0) {
            this.openDoorAt(xs, y);
            const s = { x: xs << 4, y: (y << 4) + 16 };
            this.cam.leftBound = this.getLeftBound(xs);
            this.cam.rightBound = this.getRightBound(xs);
            this.cam.lx = Math.max(Math.min(s.x - 240, this.cam.rightBound), this.cam.leftBound) & ~15;
            return s;
          }
        }
        xs = (xs + 1) & 0xFF;
      }
      return { x: 32, y: 240 };
    },
    getLeftBound(tx) {
      for (let x = tx; x > 0; x--)
        for (let y = 0; y < MAPH; y++)
          if (this.land.cells[x][y].boundary) return x * 16 - 16;
      return 0;
    },
    getRightBound(tx) {
      for (let x = tx; x < MAPW; x++)
        for (let y = 0; y < MAPH; y++)
          if (this.land.cells[x][y].boundary) return x * 16 - 512 + 16;
      return MAPW * 16 - 513;
    },

    openDoorAt(x, y) {
      for (const d of this.land.doors) {
        if (x >= d.x - 1 && x <= d.x + 2 && y >= d.y - 2 && y <= d.y + 1) {
          d.open = true; d.locked = false;
          for (let dx = 0; dx < 2; dx++) for (let dy = -1; dy <= 0; dy++) {
            const c = this.cell(d.x + dx, d.y + dy);
            if (c) c.locked = false;
          }
        }
      }
    },
    enterDoor(cx, cy, id) {
      const dlist = this.land.doors.filter(d => d.id === id).sort((a, b) => a.x - b.x);
      if (!dlist.length) return;
      let dest = dlist.find(d => d.x > cx + 1) || dlist[0];
      this.checkPoint = id;
      this.startX = dest.x;
      this.beginRestart();
    },
    clearCP() {
      for (let x = 0; x < MAPW; x++) for (let y = 0; y < MAPH; y++) {
        const c = this.land.cells[x][y];
        if (c.cp === 1 && c.sprite === 0) c.cp = 0;
      }
    },
    clearBonus(x, y, keepDeco) {
      const c = this.cell(x, y);
      if (c) c.bonus = 0;
    },
    throwSwitch() {
      this.leverFlip ^= 1;
      for (let x = 0; x < MAPW; x++) for (let y = 0; y < MAPH; y++) {
        const c = this.land.cells[x][y];
        if (c.toggle) {
          c.block = c.block === 1 ? 4 : 1;
          c.fore = c.block === 1 ? TILES.runeOn : TILES.runeOff;
        }
      }
    },

    beginRestart() { this.restarting = true; this.fade = -128; },
    finishRestart() {
      this.restarting = false;
      if (this.wasDead && S.lives <= 0) {
        store({ hiscore: S.hiscore, level: this.level, score: S.score });
        this.state = 'gameover';
        return;
      }
      if (this.nextLevel) {
        this.level = (this.level % LEVELS.length) + 1;
        S.key = false;
        this.loadLevel(this.level);
      }
      const died = this.wasDead;
      this.initBobs();
      if (died) S.invincible = 80;
    },

    togglePause() {
      if (this.state === 'playing' && this.fade === 0) this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    },

    moveCamera() {
      const cam = this.cam;
      const dx = this.player.r.x - cam.lx;
      if (dx < 176) cam.lx = Math.max(cam.lx + (dx - 176), cam.leftBound);
      else if (dx > 320) cam.lx = Math.min(cam.lx + (dx - 320), cam.rightBound);
      const lo = (cam.lx >> 4) - 1, hi = ((cam.lx + 512) >> 4) + 1;
      if (lo < this.prevLo) for (let x = lo; x < Math.min(this.prevLo, hi); x++) this.spawnColumn(x);
      if (hi > this.prevHi) for (let x = Math.max(this.prevHi + 1, lo); x <= hi; x++) this.spawnColumn(x);
      this.prevLo = lo; this.prevHi = hi;
    },

    step() {
      this.tick++;
      if (this.state !== 'playing') return;
      if (this.lostFocus || Joy.rebind) return;
      if (this.levelCardT > 0) this.levelCardT--;

      if (this.fade > 0) { this.fade = Math.max(0, this.fade - 8); return; }
      if (this.restarting) {
        if (this.fade < 0) { this.fade = Math.min(0, this.fade + 4); return; }
        this.finishRestart();
        return;
      }
      if (this.freeze > 0) { this.freeze--; return; }

      this.moveCamera();
      for (let i = this.bobs.length - 1; i >= 0; i--) {
        const b = this.bobs[i];
        b.move();
        if (i > 0 && b.outOfBounds(this.cam.lx)) {
          if (b.start.x || b.start.y) {
            const c = this.cell(b.start.x, b.start.y);
            if (c) c.spawned = false;
          }
          this.bobs.splice(i, 1);
        }
      }
    },

    /* ------------------------------- drawing ------------------------------- */
    draw() {
      ctx.fillStyle = '#0d0817';
      ctx.fillRect(0, 0, 480, 256);
      if (this.state === 'intro' || this.state === 'gameover') { this.drawTitle(); return; }

      const ox = this.cam.lx + 16;
      TILES.drawSky(ctx, this.land.theme, this.cam.lx, this.tick);
      this.drawWater(ox);
      this.drawDecos(ox);
      this.drawLand(ox);
      this.drawItems(ox);
      for (let i = this.bobs.length - 1; i >= 0; i--) {
        const b = this.bobs[i];
        if (b.r.x - ox > -80 && b.r.x - ox < 560) b.draw(ctx, ox);
      }
      this.drawHUD();
      this.drawFade();
      if (this.levelCardT > 0 && this.fade === 0) {
        const t = `LEVEL ${this.level}  ${this.land.name}`;
        PX.drawText(ctx, t, 240 - PX.textWidth(t, 2) / 2, 44, '#fff1a8', 2, '#1a1129');
      }
      if (this.state === 'paused') this.overlayText(['PAUSED', '', `PRESS ${KEY_LABEL(Joy.keys.p)} TO CONTINUE`]);
      if (this.lostFocus) this.overlayText(['LOST KEYBOARD FOCUS!', '', 'CLICK HERE TO CARRY ON']);
      if (Joy.rebind) this.overlayText(['REDEFINE KEYS', '', `PRESS KEY FOR ${Joy.rebind.names[Joy.rebind.step]}`, '', 'ESC TO CANCEL']);
    },

    drawLand(ox) {
      const x0 = ox >> 4, x1 = (ox + 480) >> 4;
      for (let x = x0; x <= x1 && x < MAPW; x++) {
        if (x < 0) continue;
        for (let y = 0; y < MAPH; y++) {
          const c = this.land.cells[x][y];
          if (c.back) ctx.drawImage(c.back.canvas, x * 16 - ox, y * 16);
          if (c.fore) ctx.drawImage(c.fore.canvas, x * 16 - ox, y * 16);
        }
      }
    },

    drawWater(ox) {
      if (!this.land.water.length) return;
      const t = this.tick;
      for (const x of this.land.water) {
        const sx = x * 16 - ox;
        if (sx < -16 || sx > 480) continue;
        ctx.fillStyle = '#2a5ec8aa';
        ctx.fillRect(sx, 246, 16, 10);
        ctx.fillStyle = '#7df0ff';
        const w = ((t >> 3) + x) & 1;
        ctx.fillRect(sx + (w ? 0 : 8), 246, 8, 1);
      }
    },

    drawDecos(ox) {
      for (const d of this.land.decos) {
        const sx = d.x * 16 - ox;
        if (sx < -64 || sx > 528) continue;
        const baseY = d.y * 16 + 16;
        switch (d.kind) {
          case 'flora': ctx.drawImage(d.frame.canvas, sx, baseY - 16); break;
          case 'torch': {
            const fr = (this.tick >> 3) & 1 ? TILES.torchA : TILES.torchB;
            ctx.drawImage(fr.canvas, sx, baseY - 16);
            ctx.fillStyle = '#ff9a3c18';
            ctx.beginPath(); ctx.arc(sx + 7, baseY - 12, 14, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'spring': ctx.drawImage(TILES.spring.canvas, sx, baseY - 16); break;
          case 'lever': ctx.drawImage((this.leverFlip ? TILES.leverR : TILES.leverL).canvas, sx, baseY - 16); break;
          case 'exit': {
            ctx.drawImage(TILES.exitArch.canvas, sx - 8, baseY - 48);
            break;
          }
        }
      }
      for (const d of this.land.doors) {
        const sx = d.x * 16 - ox;
        if (sx < -48 || sx > 528) continue;
        const art = d.open ? TILES.doorOpen : d.locked ? TILES.doorLocked : TILES.doorClosed;
        ctx.drawImage(art.canvas, sx, d.y * 16 + 16 - 27);
      }
      for (const w of this.land.ways) {
        const sx = w.x * 16 - ox;
        if (sx < -16 || sx > 496) continue;
        const lit = this.cell(w.x, w.y).cp === 1;
        ctx.drawImage((lit ? TILES.wayLit : TILES.wayDim).canvas, sx, w.y * 16 + 16 - 19);
      }
    },

    drawItems(ox) {
      const x0 = ox >> 4, x1 = (ox + 480) >> 4;
      for (let x = Math.max(0, x0); x <= x1 && x < MAPW; x++) {
        for (let y = 0; y < MAPH; y++) {
          const c = this.land.cells[x][y];
          const icon = TILES.items[c.bonus];
          if (icon) {
            const bob = Math.round(Math.sin((this.tick + x * 5 + y * 3) * 0.12) * 2);
            ctx.drawImage(icon.canvas, x * 16 - ox, y * 16 + bob);
          }
        }
      }
    },

    drawHUD() {
      PX.drawText(ctx, String(S.score).padStart(7, '0'), 8, 8, '#f4f6ff', 2, '#1a1129');
      for (let i = 0; i < Math.min(S.lives, 8); i++) {
        ctx.drawImage(TILES.lifeIcon.canvas, 8 + i * 13, 26);
      }
      if (S.key) ctx.drawImage(TILES.keyIcon.canvas, 96, 6);
      TILES.drawFlask(ctx, 450, 6, (S.potions % SPELL_COST) / SPELL_COST);
      PX.drawText(ctx, String(S.potions % SPELL_COST).padStart(2, '0'), 432, 12, '#dba2e8', 2, '#1a1129');
      for (let i = 0; i < S.spells; i++) {
        const ic = TILES.spellIcons[i];
        ctx.drawImage(ic.canvas, 444 - S.spells * 14 + i * 14, 8);
      }
    },

    drawFade() {
      ctx.fillStyle = '#0d0817';
      if (this.fade > 0) { // curtains opening from all sides
        ctx.fillRect(0, 0, 480, this.fade * 2 - 8);
        ctx.fillRect(0, 256 - this.fade * 2 + 8, 480, 256);
        ctx.fillRect(0, 0, this.fade * 3.5, 256);
        ctx.fillRect(480 - this.fade * 3.5, 0, 480, 256);
      } else if (this.fade < 0) { // closing from top/bottom
        const f = 128 + this.fade;
        ctx.fillRect(0, 0, 480, 128 - f);
        ctx.fillRect(0, 128 + f, 480, 128);
      }
    },

    overlayText(lines) {
      ctx.fillStyle = '#0d0817b8';
      ctx.fillRect(60, 88, 360, 24 + lines.length * 14);
      ctx.strokeStyle = '#ffd75e';
      ctx.strokeRect(60.5, 88.5, 359, 23 + lines.length * 14);
      lines.forEach((t, i) => {
        if (!t) return;
        const w = PX.textWidth(t, 2);
        PX.drawText(ctx, t, 240 - w / 2, 102 + i * 14, i === 0 ? '#ffd75e' : '#f4f6ff', 2, '#1a1129');
      });
    },

    drawTitle() {
      TILES.drawSky(ctx, 'court', this.tick * 2, this.tick);
      ctx.fillStyle = '#0d0817';
      ctx.fillRect(0, 232, 480, 24);
      // big logo
      const t = this.tick;
      const ly = 38 + Math.round(Math.sin(t * 0.05) * 2);
      PX.drawText(ctx, 'wiz4', 240 - PX.textWidth('wiz4', 9) / 2 + 4, ly + 4, '#1a1129', 9);
      PX.drawText(ctx, 'wiz4', 240 - PX.textWidth('wiz4', 9) / 2, ly, '#ffd75e', 9);
      PX.drawText(ctx, 'wiz4', 240 - PX.textWidth('wiz4', 9) / 2, ly - 2, '#fff1a8', 9);
      // wizard mascot
      const wf = SPRITES.wiz.frames[(t >> 3) % 4];
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(wf.canvas, 0, 0, 16, 24, 120, 150 - 36, 48, 72);
      ctx.restore();

      const flash = (t & 0x18) !== 0;
      if (this.state === 'gameover') {
        if (flash) this.centerText('GAME OVER', 130, '#e04f2a', 3);
      }
      this.centerText('PRESS S TO START', 168, '#f4f6ff', 2);
      const sv = loadSave();
      if ((sv.level || 1) > 1) this.centerText(`PRESS R TO RESUME AT LEVEL ${sv.level}`, 184, '#c9d2ec', 2);
      if (S.hiscore > 0) this.centerText(`BEST SCORE ${S.hiscore}`, 200, '#ffd75e', 2);
      this.centerText('ARROWS WALK . SPACE JUMP . UP ENTERS DOORS . DOWN DUCKS', 222, '#8d97b8', 1);
      this.centerText('COLLECT POTIONS . LEARN SPELLS . FIND THE HIDDEN ROOMS', 238, '#6c7694', 1);
      this.centerText('P PAUSE . M MUTE . F2 REDEFINE KEYS', 246, '#6c7694', 1);
    },
    centerText(s, y, col, sc) {
      PX.drawText(ctx, s, Math.round(240 - PX.textWidth(s, sc) / 2), y, col, sc, '#1a1129');
    },
  };

  /* ------------------------------ main loop ------------------------------ */
  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(now - last, 200);
    last = now;
    while (acc >= TICK) { game.step(); acc -= TICK; }
    game.draw();
    requestAnimationFrame(frame);
  }

  game.loadLevel(1); // preload so the title has a land behind logic
  game.state = 'intro';
  requestAnimationFrame(frame);

  /* ------------------------------- debug api ------------------------------ */
  window.wiz4 = {
    game, S, Joy,
    start: () => game.newGame(),
    level: (n) => { game.level = n; game.beginPlay(); },
    pos: (x, y) => { game.player.r.x = x; game.player.r.y = y; },
    god: (v) => { game.god = v !== false; },
    grant: (n) => { for (let i = S.spells; i < n; i++) S.nextSpell(0, 0); },
    state: () => ({
      state: game.state, level: game.level, fade: game.fade,
      x: game.player && game.player.r.x, y: game.player && game.player.r.y,
      lives: S.lives, score: S.score, potions: S.potions, spells: S.spells,
      bobs: game.bobs.length, cam: game.cam.lx,
    }),
  };
})();
