/**
 * ELKOPLAST — Ložné plány
 * HTTP server pro Railway / Heroku / VPS
 *
 * - Pre-comprimuje HTML (gzip + brotli) při startu
 * - ETag + 304 Not Modified pro rychlé druhé načtení
 * - Sdílené API: /api/shared (boxTypes + fleet napříč uživateli)
 *   → ukládá se do souboru DATA_DIR/shared.json (Railway Volume, jinak ./data)
 *   → pokud volume není připojený, data se uchovají do restartu kontejneru
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
      return data;
    }
  } catch (e) {
    console.warn('⚠ Chyba čtení shared.json:', e.message);
  }
  // Default prázdné — klient nahraje vlastní defaulty
  return {
    boxTypes: [], fleet: [], orders: [], team: [], activity: [], history: [],
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
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
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
    history:  sharedState.history  || []
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
  // Velikostní limity (proti přetížení)
  if (body.boxTypes.length > 1000) return res.status(400).json({ error: 'boxTypes přes 1000 položek' });
  if (body.fleet.length    > 200)  return res.status(400).json({ error: 'fleet přes 200 položek' });
  if (orders.length        > 500)  return res.status(400).json({ error: 'orders přes 500 položek' });
  if (team.length          > 100)  return res.status(400).json({ error: 'team přes 100 členů' });
  if (activity.length      > 2000) return res.status(400).json({ error: 'activity přes 2000 záznamů (omezte historii)' });
  if (history.length       > 200)  return res.status(400).json({ error: 'history přes 200 plánů' });

  sharedState = {
    version: (sharedState.version || 0) + 1,
    lastModified: new Date().toISOString(),
    lastModifiedBy: String(body.modifiedBy || 'neznámý').slice(0, 80),
    boxTypes: body.boxTypes,
    fleet: body.fleet,
    orders, team, activity, history
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
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
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
