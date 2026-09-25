/**
 * ELKOPLAST — Ložné plány
 * HTTP server pro Railway / Heroku / VPS
 *
 * - Pre-comprimuje HTML (gzip + brotli) při startu
 * - ETag + 304 Not Modified pro rychlé druhé načtení
 * - Sdílené API: /api/shared (boxTypes + fleet napříč uživateli)
 *   → ukládá se do souboru DATA_DIR/shared.json (Railway Volume, jinak ./data)
 *   → pokud volume není připojený, data se uchovají do restartu kontejneru
 * - SSO z intranetu: s nastaveným INTRANET_SSO_SECRET pouští jen přihlášené
 *   (intranet modul „Ložný plán" → /loznyplan-app → redirect sem s ?sso=token)
 *
 * Environment:
 *   INTRANET_SSO_SECRET — sdílené tajemství s intranetem (= SSO_SHARED_SECRET intranetu);
 *                         bez něj běží aplikace otevřeně (lokální vývoj)
 *   INTRANET_URL        — adresa intranetu pro odkaz „přihlásit se" (výchozí https://intranet.elkoplast.cz)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ── Sdílené úložiště pro boxTypes/fleet ───────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SHARED_FILE = path.join(DATA_DIR, 'shared.json');

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    return true;
  } catch (e) {
    console.warn('⚠ Nelze vytvořit DATA_DIR:', DATA_DIR, '—', e.message);
    return false;
  }
}

function loadShared() {
  try {
    if (fs.existsSync(SHARED_FILE)) {
      const data = JSON.parse(fs.readFileSync(SHARED_FILE, 'utf8'));
      console.log('   Načteno sdílené úložiště:',
        (data.boxTypes || []).length, 'typů beden,',
        (data.fleet || []).length, 'vozidel,',
        (data.orders || []).length, 'objednávek,',
        (data.team || []).length, 'členů týmu,',
        (data.activity || []).length, 'aktivit,',
        (data.history || []).length, 'plánů v historii,',
        'version', data.version || 0);
      // Zajistit, že všechny pole existují (pro starší shared.json)
      data.orders   = data.orders   || [];
      data.team     = data.team     || [];
      data.activity = data.activity || [];
      data.history  = data.history  || [];
      // Náhrobky smazaných objednávek/plánů — bez nich by je klienti se starou
      // lokální kopií při syncu „vzkřísili" a nahráli zpátky na server
      data.deletedOrders  = data.deletedOrders  || [];
      data.deletedHistory = data.deletedHistory || [];
      data.deletedFleet   = data.deletedFleet   || [];
      data.vehPresets     = data.vehPresets     || [];
      return data;
    }
  } catch (e) {
    console.warn('⚠ Chyba čtení shared.json:', e.message);
  }
  // Default prázdné — klient nahraje vlastní defaulty
  return {
    boxTypes: [], fleet: [], orders: [], team: [], activity: [], history: [],
    deletedOrders: [], deletedHistory: [], deletedFleet: [], vehPresets: [],
    version: 0, lastModified: null, lastModifiedBy: null
  };
}

function saveShared(data) {
  if (!ensureDataDir()) return false;
  try {
    fs.writeFileSync(SHARED_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('⚠ Chyba zápisu shared.json:', e.message);
    return false;
  }
}

// In-memory cache + persistování na disk
let sharedState = loadShared();

// ── HTML pre-compression ──────────────────────────────────────────────
const APP_HTML_PATH = path.join(__dirname, 'lozny-plan-v3-stohovani.html');
const EMBED_HTML_PATH = path.join(__dirname, 'elkoplast-lozny-plan-embed.html');

function precompress(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn('⚠ File missing:', filePath);
    return null;
  }
  const raw = fs.readFileSync(filePath);
  const gzip = zlib.gzipSync(raw, { level: 9 });
  const brotli = zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  const etag = '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"';
  return { raw, gzip, brotli, etag, size: raw.length };
}

console.log('📦 Pre-compressing assets...');
const APP_DATA = precompress(APP_HTML_PATH);
const EMBED_DATA = precompress(EMBED_HTML_PATH);

if (APP_DATA) {
  const sav = (1 - APP_DATA.brotli.length / APP_DATA.size) * 100;
  console.log(`   lozny-plan-v3-stohovani.html: ${(APP_DATA.size/1024).toFixed(1)} kB → ` +
              `gzip ${(APP_DATA.gzip.length/1024).toFixed(1)} kB · ` +
              `brotli ${(APP_DATA.brotli.length/1024).toFixed(1)} kB (úspora ${sav.toFixed(0)} %)`);
}

function sendPrecompressed(req, res, data) {
  if (!data) { res.status(404).send('Not Found'); return; }
  if (req.headers['if-none-match'] === data.etag) {
    res.status(304).end();
    return;
  }
  const acceptEncoding = req.headers['accept-encoding'] || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', data.etag);
  res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
  if (/\bbr\b/.test(acceptEncoding)) {
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Content-Length', data.brotli.length);
    res.end(data.brotli);
  } else if (/\bgzip\b/.test(acceptEncoding)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', data.gzip.length);
    res.end(data.gzip);
  } else {
    res.setHeader('Content-Length', data.size);
    res.end(data.raw);
  }
}

// ── Middleware: JSON body parser + CORS pro API ────────────────────────
app.use(express.json({ limit: '8mb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ══════════════════════════════════════════════════════════════════════
//  SSO z intranetu (vzor prekladiste-kalkulacka): intranet přesměruje
//  s ?sso=<token>, token = b64url(JSON{email,name,exp}) + "." + HMAC-SHA256("sso:"+data)[0..32].
//  Server token ověří, nastaví vlastní session cookie a dál pouští jen přihlášené.
//  Bez INTRANET_SSO_SECRET běží aplikace otevřeně (lokální vývoj).
// ══════════════════════════════════════════════════════════════════════
const SSO_SECRET = (process.env.INTRANET_SSO_SECRET || '').trim();
const INTRANET_URL = (process.env.INTRANET_URL || 'https://intranet.elkoplast.cz').replace(/\/$/, '');
const SESSION_MS = 12 * 3600 * 1000; // vlastní session po ověření tokenu (12 h)

function b64urlDecode(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Buffer.from(s, 'base64').toString('utf8'); }
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function ssoHmac(prefix, data) { return crypto.createHmac('sha256', SSO_SECRET).update(prefix + data).digest('hex').slice(0, 32); }
// Ověří podepsaný token/cookie (prefix "sso:" pro token z intranetu, "emp:" pro naši session).
function ssoVerify(str, prefix) {
  if (!str) return null;
  const i = str.lastIndexOf('.'); if (i < 0) return null;
  const data = str.slice(0, i), sig = str.slice(i + 1);
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ssoHmac(prefix, data))); } catch (_) { return null; }
  if (!ok) return null;
  try { const p = JSON.parse(b64urlDecode(data)); return (p && p.email && (!p.exp || Date.now() < p.exp)) ? p : null; } catch (_) { return null; }
}
function sessionSign(emp) { const data = b64url(JSON.stringify({ email: emp.email, name: emp.name || emp.email, exp: Date.now() + SESSION_MS })); return data + '.' + ssoHmac('emp:', data); }
function cookieVal(req, name) { const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }

function loginPage() {
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Ložný plán — přihlášení</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#eef1ec;color:#0f1512;display:grid;place-items:center;min-height:100vh}'
    + '.c{max-width:460px;text-align:center;background:#fff;border:1px solid #e3e7e0;border-radius:16px;padding:34px 30px;box-shadow:0 10px 30px rgba(15,21,18,.07)}'
    + 'h1{font-size:20px;margin:0 0 8px}p{color:#5b635c;margin:0 0 18px;line-height:1.55}'
    + 'a{display:inline-block;background:linear-gradient(135deg,#15ab57,#0a6b34);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600}</style></head>'
    + '<body><div class="c"><h1>🚚 Ložný plán</h1><p>Aplikace je dostupná zaměstnancům ELKOPLAST přes intranet.</p>'
    + '<a href="' + INTRANET_URL + '/loznyplan-app" target="_top">Přihlásit se přes intranet →</a></div></body></html>';
}

// Závora: platný ?sso= token z intranetu → vlastní session cookie; jinak platná cookie; jinak přihlášení.
app.use((req, res, next) => {
  if (!SSO_SECRET) return next();                 // SSO vypnuté → otevřený provoz (vývoj)
  if (req.path === '/health') return next();      // healthcheck pro Railway vždy
  const tok = ssoVerify(String(req.query.sso || ''), 'sso:');
  if (tok) {
    // SameSite=None kvůli iframu v intranetu (cross-site); vyžaduje Secure (Railway běží na HTTPS).
    res.setHeader('Set-Cookie', 'lp_emp=' + encodeURIComponent(sessionSign(tok)) + '; HttpOnly; Path=/; Max-Age=' + Math.floor(SESSION_MS / 1000) + '; SameSite=None; Secure');
    req.employee = { email: tok.email, name: tok.name || tok.email };
    return next();
  }
  const sess = ssoVerify(cookieVal(req, 'lp_emp'), 'emp:');
  if (sess) { req.employee = { email: sess.email, name: sess.name }; return next(); }
  res.status(401).type('html; charset=utf-8').send(loginPage());
});

// ── API: sdílené úložiště pro boxTypes/fleet ───────────────────────────

// GET /api/shared — vrátí kompletní sdílený stav
app.get('/api/shared', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.json({
    version: sharedState.version || 0,
    lastModified: sharedState.lastModified,
    lastModifiedBy: sharedState.lastModifiedBy,
    boxTypes: sharedState.boxTypes || [],
    fleet:    sharedState.fleet    || [],
    orders:   sharedState.orders   || [],
    team:     sharedState.team     || [],
    activity: sharedState.activity || [],
    history:  sharedState.history  || [],
    deletedOrders:  sharedState.deletedOrders  || [],
    deletedHistory: sharedState.deletedHistory || [],
    deletedFleet:   sharedState.deletedFleet   || [],
    vehPresets:     sharedState.vehPresets     || []
  });
});

// PUT /api/shared — uloží nový stav (whole object)
//   body: { boxTypes, fleet, orders, team, activity, history, modifiedBy }
app.put('/api/shared', (req, res) => {
  const body = req.body || {};
  // Validace typů
  if (!Array.isArray(body.boxTypes)) return res.status(400).json({ error: 'boxTypes must be array' });
  if (!Array.isArray(body.fleet))    return res.status(400).json({ error: 'fleet must be array' });
  // Volitelná pole — pokud nepřijdou, zachovat současné
  const orders   = Array.isArray(body.orders)   ? body.orders   : (sharedState.orders   || []);
  const team     = Array.isArray(body.team)     ? body.team     : (sharedState.team     || []);
  const activity = Array.isArray(body.activity) ? body.activity : (sharedState.activity || []);
  const history  = Array.isArray(body.history)  ? body.history  : (sharedState.history  || []);
  // Náhrobky: sjednotit s existujícími (jen přibývají), cap 2000 nejnovějších
  const unionIds = (a, b) => Array.from(new Set([...(a || []), ...(b || [])])).slice(-2000);
  const deletedOrders  = unionIds(sharedState.deletedOrders,  Array.isArray(body.deletedOrders)  ? body.deletedOrders  : []);
  const deletedHistory = unionIds(sharedState.deletedHistory, Array.isArray(body.deletedHistory) ? body.deletedHistory : []);
  const deletedFleet   = unionIds(sharedState.deletedFleet,   Array.isArray(body.deletedFleet)   ? body.deletedFleet   : []);
  // Editovatelné typy kamionů pro výpočet — celé nahradit, když klient posílá
  const vehPresets = (Array.isArray(body.vehPresets) && body.vehPresets.length) ? body.vehPresets.slice(0, 100) : (sharedState.vehPresets || []);
  // Velikostní limity (proti přetížení)
  if (body.boxTypes.length > 1000) return res.status(400).json({ error: 'boxTypes přes 1000 položek' });
  if (body.fleet.length    > 200)  return res.status(400).json({ error: 'fleet přes 200 položek' });
  if (orders.length        > 500)  return res.status(400).json({ error: 'orders přes 500 položek' });
  if (team.length          > 100)  return res.status(400).json({ error: 'team přes 100 členů' });
  if (activity.length      > 2000) return res.status(400).json({ error: 'activity přes 2000 záznamů (omezte historii)' });
  if (history.length       > 200)  return res.status(400).json({ error: 'history přes 200 plánů' });

  // Smazané položky nesmí projít zpět ani od klientů se starou verzí appky
  const delOrdersSet  = new Set(deletedOrders);
  const delHistorySet = new Set(deletedHistory);
  const delFleetSet   = new Set(deletedFleet);
  sharedState = {
    version: (sharedState.version || 0) + 1,
    lastModified: new Date().toISOString(),
    lastModifiedBy: String(body.modifiedBy || 'neznámý').slice(0, 80),
    boxTypes: body.boxTypes,
    fleet: body.fleet.filter(v => !delFleetSet.has(v.id)),
    orders:  orders.filter(o => !delOrdersSet.has(o.id)),
    team, activity,
    history: history.filter(h => !delHistorySet.has(h.id)),
    deletedOrders, deletedHistory, deletedFleet, vehPresets
  };
  const saved = saveShared(sharedState);
  console.log(`📝 /api/shared PUT: v${sharedState.version} by ${sharedState.lastModifiedBy} ` +
    `(${sharedState.boxTypes.length} typů, ${sharedState.fleet.length} vozů, ` +
    `${sharedState.orders.length} obj., ${sharedState.team.length} členů, ` +
    `${sharedState.activity.length} aktivit, ${sharedState.history.length} plánů)` +
    `${saved ? '' : ' — POZOR: nelze persistovat na disk'}`);
  res.json({
    version: sharedState.version,
    lastModified: sharedState.lastModified,
    persisted: saved
  });
});

// Health check
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  app: 'elkoplast-lozny-plan',
  version: process.env.APP_VERSION || '1.0.0',
  uptime: process.uptime(),
  htmlSize: APP_DATA ? APP_DATA.size : null,
  brotliSize: APP_DATA ? APP_DATA.brotli.length : null,
  shared: {
    boxTypes: (sharedState.boxTypes || []).length,
    fleet: (sharedState.fleet || []).length,
    version: sharedState.version || 0,
    lastModified: sharedState.lastModified,
    dataDir: DATA_DIR,
    persistent: ensureDataDir()
  },
  timestamp: new Date().toISOString()
}));

// ── Hlavní stránka + statické ───────────────────────────────────────────
app.get('/', (req, res) => sendPrecompressed(req, res, APP_DATA));
app.get('/embed', (req, res) => sendPrecompressed(req, res, EMBED_DATA));

app.use(express.static(__dirname, {
  index: false,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
    } else if (/\.(js|css|woff2?|ttf|png|svg|jpg|jpeg|webp)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(PORT, HOST, () => {
  console.log(`✓ ELKOPLAST Lozny plany v${process.env.APP_VERSION || '1.0.0'} listening on http://${HOST}:${PORT}`);
  console.log(`  Production: ${process.env.NODE_ENV === 'production' ? 'YES' : 'NO'}`);
  console.log(`  Data dir:   ${DATA_DIR} ${ensureDataDir() ? '✓' : '⚠ NEZAPSATELNÉ'}`);
  console.log(`  Health:     http://${HOST}:${PORT}/health`);
});

process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down...');  process.exit(0); });
