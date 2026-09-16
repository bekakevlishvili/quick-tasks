// Builds "Quick Tasks.app" for macOS without a Mac.
//
// Takes the official Electron macOS zip, and rewrites it entry by entry: renames the bundle, swaps in our
// Info.plist, icon and app.asar, and keeps every Unix permission bit and symlink exactly as Electron shipped
// them. The result is a zip that unpacks cleanly with Archive Utility. Nothing is code-signed (that needs a
// Mac and an Apple developer account), so first launch requires the usual Gatekeeper step; see the read-me
// that gets dropped into the zip.
//
// Usage: node scripts/make-mac.js [arm64|x64|all]     (default: all)
// Output: dist/Quick Tasks-mac-apple-silicon.zip, dist/Quick Tasks-mac-intel.zip

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const crypto = require('crypto');
const { makeIcns } = require('./make-icons');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;

const APP = pkg.productName;                 // "Quick Tasks"
const BUNDLE_ID = 'com.quicktasks.app';
const ICON_NAME = 'quicktasks.icns';
const CACHE = path.join(root, 'dist', '.cache');
const OUT = path.join(root, 'dist');
const ARCH_LABEL = { arm64: 'apple-silicon', x64: 'intel' };

// Files that make up the app itself (what goes into app.asar). Windows-only bits stay out.
const APP_FILES = ['package.json', 'main.js', 'preload.js', 'index.html', 'README.md',
  'assets/tray.png', 'assets/trayTemplate.png', 'assets/trayTemplate@2x.png', 'assets/icon.png'];

// ---------------------------------------------------------------- download

function download(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 8) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'quick-tasks-build' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => { file.close(); fs.renameSync(tmp, dest); resolve(dest); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function electronZip(arch) {
  fs.mkdirSync(CACHE, { recursive: true });
  const name = `electron-v${electronVersion}-darwin-${arch}.zip`;
  const dest = path.join(CACHE, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50e6) return dest;
  console.log(`downloading ${name}…`);
  await download(`https://github.com/electron/electron/releases/download/v${electronVersion}/${name}`, dest);
  return dest;
}

// ---------------------------------------------------------------- zip reading

// Returns entries with their *compressed* bytes, so we can copy them into the new archive untouched.
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archives are not handled');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory at ${p}`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const e = {
      madeBy: buf.readUInt16LE(p + 4),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      compSize: buf.readUInt32LE(p + 20),
      uncompSize: buf.readUInt32LE(p + 24),
      extAttrs: buf.readUInt32LE(p + 38),
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
    };
    const local = buf.readUInt32LE(p + 42);
    if (e.compSize === 0xffffffff || e.uncompSize === 0xffffffff || local === 0xffffffff) throw new Error('zip64 entry not handled');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    e.data = buf.subarray(dataStart, dataStart + e.compSize);
    e.mode = e.extAttrs >>> 16;
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const inflate = (e) => (e.method === 8 ? zlib.inflateRawSync(e.data) : e.method === 0 ? Buffer.from(e.data) : (() => { throw new Error(`unsupported method ${e.method} for ${e.name}`); })());

// ---------------------------------------------------------------- zip writing

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// A fresh entry from raw content. mode is a full Unix st_mode, e.g. 0o100644 (file) or 0o100755 (executable).
function newEntry(name, content, mode = 0o100644) {
  const data = zlib.deflateRawSync(content, { level: 9 });
  return { name, method: 8, crc: zlib.crc32(content), compSize: data.length, uncompSize: content.length, data, mode, ...dosDateTime() };
}

function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compSize, 18);
    local.writeUInt32LE(e.uncompSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, e.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 30, 4);    // made by: Unix, so extractors apply the mode bits
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(e.time, 12);
    cd.writeUInt16LE(e.date, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.compSize, 20);
    cd.writeUInt32LE(e.uncompSize, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);               // extra
    cd.writeUInt16LE(0, 32);               // comment
    cd.writeUInt16LE(0, 34);               // disk
    cd.writeUInt16LE(0, 36);               // internal attrs
    cd.writeUInt32LE((e.mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + e.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...parts, cdBuf, eocd]);
  if (out.length >= 0xffffffff || entries.length >= 0xffff) throw new Error('archive too large for plain zip');
  return out;
}

// ---------------------------------------------------------------- asar

// Electron's archive format: [u32 4][u32 headerLen][u32 payloadLen][u32 jsonLen][json, padded to 4] then file bytes.
function packAsar(files) {
  const header = { files: {} };
  const contents = [];
  let offset = 0;
  for (const { name, content, executable } of files) {
    const segs = name.split('/');
    let node = header;
    for (const seg of segs.slice(0, -1)) node = node.files[seg] = node.files[seg] || { files: {} };
    node.files[segs.at(-1)] = { size: content.length, offset: String(offset), ...(executable ? { executable: true } : {}) };
    contents.push(content);
    offset += content.length;
  }
  const headerString = JSON.stringify(header);
  const json = Buffer.from(headerString, 'utf8');
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4);
  json.copy(padded);
  const payload = Buffer.alloc(4 + padded.length);
  payload.writeUInt32LE(json.length, 0);
  padded.copy(payload, 4);
  const headerBuf = Buffer.alloc(4 + payload.length);
  headerBuf.writeUInt32LE(payload.length, 0);
  payload.copy(headerBuf, 4);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);
  return {
    buffer: Buffer.concat([sizeBuf, headerBuf, ...contents]),
    hash: crypto.createHash('sha256').update(headerString).digest('hex'), // what ElectronAsarIntegrity wants
  };
}

function appFiles() {
  return APP_FILES.map((name) => ({ name, content: fs.readFileSync(path.join(root, name)) }));
}

// ---------------------------------------------------------------- Info.plist

function editPlist(xml, asarHash) {
  const set = (key, value) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (!re.test(xml)) throw new Error(`Info.plist has no ${key}`);
    xml = xml.replace(re, `$1${value}$2`);
  };
  set('CFBundleDisplayName', APP);
  set('CFBundleExecutable', APP);
  set('CFBundleIconFile', ICON_NAME);
  set('CFBundleIdentifier', BUNDLE_ID);
  set('CFBundleName', APP);
  set('CFBundleShortVersionString', pkg.version);
  set('CFBundleVersion', pkg.version);
  set('LSApplicationCategoryType', 'public.app-category.productivity');

  const integrity = `<key>ElectronAsarIntegrity</key>
	<dict>
		<key>Resources/app.asar</key>
		<dict>
			<key>algorithm</key>
			<string>SHA256</string>
			<key>hash</key>
			<string>${asarHash}</string>
		</dict>
	</dict>`;
  const intRe = /<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<\/dict>\s*<\/dict>/;
  if (!intRe.test(xml)) throw new Error('Info.plist has no ElectronAsarIntegrity block');
  xml = xml.replace(intRe, integrity);

  // Menu-bar-only app: no Dock icon, ever
  xml = xml.replace(/<\/dict>\s*<\/plist>\s*$/, `	<key>LSUIElement</key>
	<true/>
	<key>NSHumanReadableCopyright</key>
	<string>${APP} ${pkg.version}</string>
</dict>
</plist>
`);
  return xml;
}

// ---------------------------------------------------------------- read-me for the zip

const README = `${APP} for Mac
${'='.repeat(APP.length + 8)}

1. Drag "${APP}.app" into your Applications folder.

2. First launch. This build isn't signed with an Apple developer certificate, so macOS
   will refuse it once. Two ways past that:

   a) Double-click the app, dismiss the warning, then open
      System Settings > Privacy & Security, scroll down, and click "Open Anyway".

   b) If macOS says the app is "damaged", open Terminal and paste:
         xattr -cr "/Applications/${APP}.app"
      then open the app normally.

   You only do this once.

3. Nothing opens on launch. A small checkbox icon appears in the menu bar.
   Press  ⌘ + Shift + Space  from anywhere to bring up the panel; Esc hides it.
   Click the menu-bar icon for appearance, start-at-login and Quit.

Your tasks are saved in ~/Library/Application Support/${APP}/tasks.json

Shortcuts: press ? inside the panel.
`;

// ---------------------------------------------------------------- build

async function build(arch) {
  const zipPath = await electronZip(arch);
  const source = readZip(fs.readFileSync(zipPath));
  const asar = packAsar(appFiles());
  const icns = makeIcns();

  const PREFIX = 'Electron.app/';
  const out = [];
  let plistDone = false;
  for (const e of source) {
    if (!e.name.startsWith(PREFIX)) continue;                       // LICENSE, version, …
    const rel = e.name.slice(PREFIX.length);
    let name = `${APP}.app/${rel}`;
    if (rel === 'Contents/Resources/default_app.asar') continue;    // replaced by app.asar
    if (rel === 'Contents/Resources/electron.icns') {
      out.push(newEntry(`${APP}.app/Contents/Resources/${ICON_NAME}`, icns, e.mode));
      continue;
    }
    if (rel === 'Contents/Info.plist') {
      out.push(newEntry(name, Buffer.from(editPlist(inflate(e).toString('utf8'), asar.hash), 'utf8'), e.mode));
      plistDone = true;
      continue;
    }
    if (rel === 'Contents/MacOS/Electron') name = `${APP}.app/Contents/MacOS/${APP}`; // app.isPackaged keys off this name
    out.push({ ...e, name });
  }
  if (!plistDone) throw new Error('Info.plist not found in Electron zip');
  out.push(newEntry(`${APP}.app/Contents/Resources/app.asar`, asar.buffer, 0o100644));
  out.push(newEntry('Read me first.txt', Buffer.from(README, 'utf8'), 0o100644));

  const zip = writeZip(out);
  fs.mkdirSync(OUT, { recursive: true });
  const dest = path.join(OUT, `${APP}-mac-${ARCH_LABEL[arch]}.zip`);
  fs.writeFileSync(dest, zip);

  const symlinks = out.filter((e) => (e.mode & 0o170000) === 0o120000).length;
  const main = out.find((e) => e.name === `${APP}.app/Contents/MacOS/${APP}`);
  console.log(`${path.relative(root, dest)}  ${(zip.length / 1e6).toFixed(1)} MB, ${out.length} entries, ${symlinks} symlinks, main binary mode ${main.mode.toString(8)}`);
  return dest;
}

(async () => {
  const want = process.argv[2] || 'all';
  const archs = want === 'all' ? ['arm64', 'x64'] : [want];
  for (const arch of archs) {
    if (!ARCH_LABEL[arch]) throw new Error(`unknown arch ${arch}; use arm64, x64 or all`);
    await build(arch);
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
