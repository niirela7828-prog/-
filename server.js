'use strict';
// פתק עבודה – שרת Node.js ללא תלויות חיצוניות.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const FIELDS = require('./fields');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_HOURS = 12;
const MAX_BODY = 64 * 1024;
const MAX_FIELD = 4000;

// ---------- storage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadNotes() {
  try {
    return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

let notes = loadNotes();

function saveNotes() {
  const tmp = NOTES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
  fs.renameSync(tmp, NOTES_FILE);
}

// ---------- auth ----------
// Signing key changes on each restart, so restarting logs the admin out.
const SECRET = crypto.randomBytes(32);

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function makeSession() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return exp + '.' + sign(exp);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validSession(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

function passwordOk(pw) {
  return ADMIN_PASSWORD.length > 0 && safeEqual(pw, ADMIN_PASSWORD);
}

// Simple brute-force protection: 10 failed attempts per IP per 15 minutes.
const failures = new Map();
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0] : req.socket.remoteAddress || '').trim();
}
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 15 * 60 * 1000) { failures.delete(ip); return false; }
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 15 * 60 * 1000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

function isAdmin(req) {
  if (validSession(parseCookies(req).session)) return true;
  // HTTP Basic auth (any user name) – lets scripts check the admin page.
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const ip = clientIp(req);
    if (tooManyFailures(ip)) return false;
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const pw = decoded.slice(decoded.indexOf(':') + 1);
    if (passwordOk(pw)) return true;
    recordFailure(ip);
  }
  return false;
}

// ---------- helpers ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

function redirect(res, to, extra = {}) {
  res.writeHead(303, { Location: to, ...SECURITY_HEADERS, ...extra });
  res.end();
}

function cookie(req, name, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// ---------- texts ----------
const T = {
  he: {
    dir: 'rtl', title: 'פתק עבודה', send: 'שליחה', sent: 'הפתק נשלח בהצלחה. תודה!',
    another: 'מילוי פתק חדש', required: 'שדה חובה', missing: 'יש למלא את כל שדות החובה',
    other: 'ภาษาไทย', otherLang: 'th',
  },
  th: {
    dir: 'ltr', title: 'ใบงาน', send: 'ส่ง', sent: 'ส่งใบงานเรียบร้อยแล้ว ขอบคุณ!',
    another: 'กรอกใบงานใหม่', required: 'จำเป็นต้องกรอก', missing: 'กรุณากรอกช่องที่จำเป็นให้ครบ',
    other: 'עברית', otherLang: 'he',
  },
};

function pickLang(req, url) {
  const q = url.searchParams.get('lang');
  if (q === 'he' || q === 'th') return q;
  const c = parseCookies(req).lang;
  if (c === 'he' || c === 'th') return c;
  return /^th\b|,\s*th\b/i.test(req.headers['accept-language'] || '') ? 'th' : 'he';
}

const CSS = `
:root{--bg:#f4f6f8;--card:#fff;--ink:#1d2733;--muted:#5d6b7a;--line:#d5dce3;--accent:#1f6feb;--ok:#1a7f37;--err:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#11161c;--card:#1a222b;--ink:#e6edf3;--muted:#9aa7b4;--line:#2f3b47;--accent:#4c8dff;--ok:#3fb950;--err:#ff6b6b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Hebrew","Noto Sans Thai",sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0 16px}
h1{font-size:1.5rem;margin:0}
.lang{color:var(--accent);text-decoration:none;font-weight:600;border:1px solid var(--line);border-radius:999px;padding:4px 14px;background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
label{display:block;font-weight:600;margin:14px 0 6px}
label:first-child{margin-top:0}
.req{color:var(--err)}
input,textarea{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
textarea{min-height:96px;resize:vertical}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
button,.btn{display:inline-block;font:inherit;font-weight:700;border:0;border-radius:10px;padding:12px 20px;background:var(--accent);color:#fff;cursor:pointer;text-decoration:none}
.full{width:100%;margin-top:18px}
.ok{color:var(--ok);font-weight:700;font-size:1.15rem}
.err{color:var(--err);font-weight:700}
.muted{color:var(--muted);font-size:.9rem}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 12px}
dt{font-weight:600;color:var(--muted)}dd{margin:0;white-space:pre-wrap;word-break:break-word}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.danger{background:var(--err);padding:6px 14px;font-size:.9rem}
.link{background:none;color:var(--accent);padding:0;font-weight:600}
`;

function page(lang, title, body, { manifest = false } = {}) {
  const t = T[lang] || T.he;
  return `<!doctype html><html lang="${lang}" dir="${t.dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${manifest ? '<link rel="manifest" href="/manifest.webmanifest">' : ''}
<link rel="icon" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-title" content="פתק עבודה"><meta name="theme-color" content="#1f6feb">
<style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

// ---------- pages ----------
function formPage(lang, { sent = false, error = '', values = {} } = {}) {
  const t = T[lang];
  const head = `<header><h1>${t.title}</h1><a class="lang" href="/?lang=${t.otherLang}">${t.other}</a></header>`;
  if (sent) {
    return page(lang, t.title, `${head}<div class="card"><p class="ok">✓ ${t.sent}</p>
<a class="btn" href="/">${t.another}</a></div>`, { manifest: true });
  }
  const inputs = FIELDS.map((f) => {
    const id = 'f_' + f.name;
    const req = f.required ? ' required' : '';
    const mark = f.required ? ` <span class="req" title="${t.required}">*</span>` : '';
    const v = values[f.name] || '';
    const input = f.type === 'textarea'
      ? `<textarea id="${id}" name="${f.name}" maxlength="${MAX_FIELD}"${req}>${esc(v)}</textarea>`
      : `<input id="${id}" name="${f.name}" type="${f.type}" maxlength="${MAX_FIELD}" value="${esc(v)}"${req}>`;
    return `<label for="${id}">${esc(f[lang])}${mark}</label>${input}`;
  }).join('\n');
  const today = `<script>(function(){var d=document.getElementById('f_date');if(d&&!d.value){var n=new Date();d.value=new Date(n-n.getTimezoneOffset()*6e4).toISOString().slice(0,10)}})()</script>`;
  return page(lang, t.title, `${head}
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form class="card" method="post" action="/submit">
<input type="hidden" name="lang" value="${lang}">
${inputs}
<button class="full" type="submit">${t.send}</button>
</form>${today}`, { manifest: true });
}

function loginPage(error = '') {
  return page('he', 'כניסת מנהל', `<header><h1>כניסת מנהל</h1></header>
<form class="card" method="post" action="/admin/login">
${error ? `<p class="err">${esc(error)}</p>` : ''}
<label for="pw">סיסמה</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button class="full" type="submit">כניסה</button>
</form>`);
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

function adminPage() {
  const list = notes.slice().reverse().map((n) => {
    const rows = FIELDS.map((f) => n.data[f.name]
      ? `<dt>${esc(f.he)}</dt><dd>${esc(n.data[f.name])}</dd>` : '').join('');
    return `<article class="card"><div class="row">
<span class="muted">נשלח: ${esc(fmtTime(n.createdAt))}${n.lang === 'th' ? ' · מולא בתאילנדית' : ''}</span>
<form method="post" action="/admin/delete" onsubmit="return confirm('למחוק את הפתק הזה?')">
<input type="hidden" name="id" value="${esc(n.id)}"><button class="danger" type="submit">מחיקה</button></form>
</div><dl>${rows}</dl></article>`;
  }).join('\n');
  return page('he', 'פתקי עבודה – ניהול', `<header><h1>פתקי עבודה (${notes.length})</h1>
<form method="post" action="/admin/logout"><button class="link" type="submit">יציאה</button></form></header>
${list || '<div class="card muted">עדיין אין פתקים.</div>'}`);
}

// ---------- static ----------
const MANIFEST = JSON.stringify({
  name: 'פתק עבודה', short_name: 'פתק עבודה', start_url: '/', scope: '/', display: 'standalone',
  background_color: '#f4f6f8', theme_color: '#1f6feb', lang: 'he', dir: 'rtl',
  icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any' }],
});

// Draw a simple 192x192 PNG icon (blue square, white note with lines) without dependencies.
function makeIcon() {
  const S = 192;
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      let c = [31, 111, 235];
      const inNote = x >= 48 && x < 144 && y >= 36 && y < 156;
      if (inNote) {
        c = [255, 255, 255];
        const line = [68, 92, 116].some((ly) => y >= ly && y < ly + 6) && x >= 62 && x < 130;
        if (line) c = [31, 111, 235];
      }
      const o = y * (S * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const ICON = makeIcon();

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && p === '/') {
    const lang = pickLang(req, url);
    const extra = url.searchParams.has('lang') ? { 'Set-Cookie': cookie(req, 'lang', lang, 365 * 86400) } : {};
    return send(res, 200, formPage(lang, { sent: url.searchParams.get('sent') === '1' }), undefined, extra);
  }

  if (m === 'POST' && p === '/submit') {
    const body = await readBody(req);
    const lang = body.get('lang') === 'th' ? 'th' : 'he';
    const data = {};
    for (const f of FIELDS) data[f.name] = (body.get(f.name) || '').trim().slice(0, MAX_FIELD);
    if (FIELDS.some((f) => f.required && !data[f.name])) {
      return send(res, 400, formPage(lang, { error: T[lang].missing, values: data }));
    }
    notes.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), lang, data });
    saveNotes();
    return redirect(res, '/?sent=1');
  }

  if (m === 'GET' && p === '/admin') {
    if (!ADMIN_PASSWORD) return send(res, 503, page('he', 'ניהול', '<div class="card err">עמוד הניהול כבוי: לא הוגדר משתנה הסביבה ADMIN_PASSWORD.</div>'));
    if (!isAdmin(req)) return send(res, 401, loginPage(), undefined, { 'Cache-Control': 'no-store' });
    return send(res, 200, adminPage(), undefined, { 'Cache-Control': 'no-store' });
  }

  if (m === 'POST' && p === '/admin/login') {
    const ip = clientIp(req);
    if (tooManyFailures(ip)) return send(res, 429, loginPage('יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.'));
    const body = await readBody(req);
    if (!passwordOk(body.get('password') || '')) {
      recordFailure(ip);
      return send(res, 401, loginPage('סיסמה שגויה'));
    }
    failures.delete(ip);
    return redirect(res, '/admin', { 'Set-Cookie': cookie(req, 'session', makeSession(), SESSION_HOURS * 3600) });
  }

  if (m === 'POST' && p === '/admin/logout') {
    return redirect(res, '/admin', { 'Set-Cookie': cookie(req, 'session', '', 0) });
  }

  if (m === 'POST' && p === '/admin/delete') {
    if (!isAdmin(req)) return send(res, 401, loginPage());
    const id = (await readBody(req)).get('id');
    const before = notes.length;
    notes = notes.filter((n) => n.id !== id);
    if (notes.length !== before) saveNotes();
    return redirect(res, '/admin');
  }

  if (m === 'GET' && p === '/manifest.webmanifest') return send(res, 200, MANIFEST, 'application/manifest+json');
  if (m === 'GET' && (p === '/icon.png' || p === '/apple-touch-icon.png' || p === '/favicon.ico')) {
    return send(res, 200, ICON, 'image/png', { 'Cache-Control': 'public, max-age=86400' });
  }
  if (m === 'GET' && p === '/health') return send(res, 200, 'ok', 'text/plain');

  return send(res, 404, page('he', 'לא נמצא', '<div class="card">העמוד לא נמצא. <a href="/">חזרה לטופס</a></div>'));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, 'שגיאה', 'text/plain; charset=utf-8');
  });
});

server.listen(PORT, () => {
  console.log(`פתק עבודה פועל על פורט ${PORT}`);
  console.log(`תיקיית נתונים: ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) console.warn('אזהרה: ADMIN_PASSWORD לא הוגדר – עמוד הניהול כבוי.');
});
