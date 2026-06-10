// px.js — builds canvases + collision masks from text pixel-maps.
// Frames are template strings: one char per pixel, '.' or ' ' = transparent.
'use strict';

const PX = (() => {
  function parse(art) {
    const rows = art.replace(/^\n+|\s+$/g, '').split('\n');
    const w = Math.max(...rows.map(r => r.length));
    return { rows, w, h: rows.length };
  }

  // Build one frame {canvas,w,h,mask} from art text + palette {char:'#rgb'}
  function frame(art, pal) {
    const { rows, w, h } = parse(art);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = x < row.length ? row[x] : '.';
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (!col) continue;
        const [r, g, b, a] = col;
        const o = (y * w + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
        mask[y * w + x] = a > 60 ? 1 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, w, h, mask };
  }

  function hex(s) { // '#rgb' | '#rrggbb' | '#rrggbbaa' -> [r,g,b,a]
    s = s.slice(1);
    if (s.length === 3) s = s.replace(/./g, c => c + c);
    const n = parseInt(s.slice(0, 6), 16);
    const a = s.length === 8 ? parseInt(s.slice(6), 16) : 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }

  function palette(map) {
    const out = {};
    for (const k in map) out[k] = hex(map[k]);
    return out;
  }

  function mirror(fr) { // horizontal flip of a built frame
    const { w, h } = fr;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(fr.canvas, 0, 0);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        mask[y * w + x] = fr.mask[y * w + (w - 1 - x)];
    return { canvas: cv, w, h, mask };
  }

  function blank(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return { canvas: cv, w, h, mask: new Uint8Array(w * h) };
  }

  // sheet: array of frames (same size) -> drawable sprite sheet
  function sheet(frames) {
    const fw = frames[0].w, fh = frames[0].h;
    return {
      fw, fh, n: frames.length, frames,
      draw(ctx, a, x, y) {
        const f = frames[Math.max(0, Math.min(frames.length - 1, a | 0))];
        ctx.drawImage(f.canvas, x | 0, y | 0);
      },
      mask(a) { return frames[Math.max(0, Math.min(frames.length - 1, a | 0))].mask; },
    };
  }

  // tiny 4x6 bitmap font, one hex nibble per row, bit3 = leftmost pixel
  const GLYPHS = {
    '0': '69bd96', '1': '262227', '2': '69124f', '3': 'e16196', '4': '99f111',
    '5': 'f8e196', '6': '68e996', '7': 'f12244', '8': '696996', '9': '699716',
    'A': '699f99', 'B': 'e9e99e', 'C': '698896', 'D': 'e9999e', 'E': 'f8e88f',
    'F': 'f8e888', 'G': '698b97', 'H': '99f999', 'I': '722227', 'J': '7222a4',
    'K': '9acca9', 'L': '88888f', 'M': '9ff999', 'N': '9ddbb9', 'O': '699996',
    'P': 'e99e88', 'Q': '6999a5', 'R': 'e99ea9', 'S': '78611e', 'T': '722222',
    'U': '999996', 'V': '999966', 'W': '999ff9', 'X': '996699', 'Y': '996222',
    'Z': 'f1248f', ' ': '000000', '.': '000044', ',': '000048', ':': '040040',
    '!': '444404', '?': '691202', '-': '00f000', "'": '448000', '/': '112488',
    '(': '244442', ')': '422224', '+': '04e400', '>': '084208', '<': '024420',
    '"': 'aa0000', '_': '00000f', '=': '0f0f00',
  };

  function textWidth(s, scale = 1) { return s.length * 5 * scale - scale; }

  function drawText(ctx, s, x, y, color, scale = 1, shadow = null) {
    s = String(s).toUpperCase();
    if (shadow) { drawText(ctx, s, x + scale, y + scale, shadow, scale); }
    ctx.fillStyle = color;
    for (let i = 0; i < s.length; i++) {
      const g = GLYPHS[s[i]];
      if (!g) continue;
      for (let r = 0; r < 6; r++) {
        const bits = parseInt(g[r], 16);
        for (let c = 0; c < 4; c++) {
          if (bits & (8 >> c)) ctx.fillRect(x + (c + i * 5) * scale, y + r * scale, scale, scale);
        }
      }
    }
  }

  return { frame, palette, mirror, blank, sheet, drawText, textWidth };
})();
