// Renders the app icon (rounded coral square with a check) to PNGs and a Windows .ico.
// No dependencies: a tiny rasteriser + PNG/ICO encoders. Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = path.join(__dirname, '..', 'assets');

// ---- geometry helpers ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---- render one size ----
// mode: 'app' (coral square, white check) or 'mono' (black check only, mac template)
function render(size, mode = 'app', inset = 0) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // 4x4 supersampling
  const s = size;
  const pad = s * inset;            // Mac icons sit inside a margin; Windows/tray icons fill the canvas
  const half = s / 2 - pad - 0.5;
  const radius = half * 2 * 0.24;
  const stroke = half * 2 * 0.11;
  // check polyline in unit space
  const A = [0.27, 0.53], B = [0.44, 0.70], C = [0.74, 0.33];
  const coral = [0xff, 0x8a, 0x5c], amber = [0xff, 0xc4, 0x6b];
  const ink = [0xff, 0xff, 0xff];

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          if (mode === 'app') {
            const d = sdRoundRect(fx, fy, s / 2, s / 2, half, half, radius);
            const cover = clamp(0.5 - d, 0, 1);
            if (cover > 0) {
              const t = clamp((fx + fy) / (2 * s), 0, 1);
              cr = lerp(coral[0], amber[0], t); cg = lerp(coral[1], amber[1], t); cb = lerp(coral[2], amber[2], t);
              ca = cover;
            }
          }
          const u = (v) => (v - 0.5) * (half * 2) / s + 0.5; // shape-relative -> canvas-relative
          const dc = Math.min(
            sdSegment(fx / s, fy / s, u(A[0]), u(A[1]), u(B[0]), u(B[1])),
            sdSegment(fx / s, fy / s, u(B[0]), u(B[1]), u(C[0]), u(C[1])),
          ) * s;
          const checkCover = clamp(stroke / 2 + 0.5 - dc, 0, 1);
          if (checkCover > 0) {
            const col = mode === 'app' ? ink : [0, 0, 0];
            cr = lerp(cr, col[0], checkCover); cg = lerp(cg, col[1], checkCover); cb = lerp(cb, col[2], checkCover);
            ca = ca + checkCover * (1 - ca);
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const i = (y * s + x) * 4;
      if (a > 0) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

// ---- PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO container (PNG entries, fine on Vista+) ----
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size === 256 ? 0 : size; e[1] = size === 256 ? 0 : size;
    e[2] = 0; e[3] = 0; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e); offset += data.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

// ---- ICNS container (PNG payloads, which macOS accepts since 10.7) ----
const ICNS_TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
function icns(entries) { // entries: [{ type, data }]
  const chunks = entries.map(({ type, data }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([h, data]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}
// Mac icons sit inside a margin (Apple's grid leaves ~10% each side), unlike Windows icons which fill the canvas
function makeIcns() {
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  return icns(sizes.map((s) => ({ type: ICNS_TYPES[s], data: png(s, render(s, 'app', 0.1)) })));
}

module.exports = { render, png, ico, icns, makeIcns };

// ---- write everything (when run directly) ----
if (require.main === module) {
  fs.mkdirSync(out, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = Object.fromEntries(sizes.map((s) => [s, png(s, render(s))]));

  fs.writeFileSync(path.join(out, 'tray.png'), pngs[32]);
  fs.writeFileSync(path.join(out, 'icon.png'), pngs[256]);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: pngs[s] }))));
  fs.writeFileSync(path.join(out, 'icon.icns'), makeIcns());
  fs.writeFileSync(path.join(out, 'trayTemplate.png'), png(16, render(16, 'mono')));
  fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), png(32, render(32, 'mono')));
  console.log('wrote', fs.readdirSync(out).join(', '));
}
