/**
 * ELKOPLAST — Ložné plány
 * Optimalizovaný HTTP server pro Railway / Heroku / VPS
 *
 * Klíčové optimalizace:
 *  1) PRE-COMPRESSED ASSETS — HTML se při startu nakomprimuje jednou
 *     do gzip + brotli a do paměti. Při requestu se posílá hotový buffer
 *     (žádné CPU každý request). Pro 770 kB HTML → ~120 kB brotli.
 *
 *  2) ETag + 304 Not Modified — prohlížeč si pamatuje hash souboru;
 *     po prvním stažení server vrací HTTP 304 (bez body). Druhé otevření
 *     je prakticky okamžité.
 *
 *  3) Inteligentní Cache-Control — HTML má krátkou cache (5 min) s
 *     `must-revalidate`, aby uživatelé dostali nové verze rychle po deployi,
 *     ale neopustili-li stránku, načítá se z paměti.
 *
 *  4) Vary: Accept-Encoding — CDN/proxy správně volí variantu.
 *
 *  5) Žádné externí závislosti při serving (express + compression)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ── Načti a předkomprimuj HTML při startu ──────────────────────────────
const APP_HTML_PATH = path.join(__dirname, 'lozny-plan-v3-stohovani.html');
const EMBED_HTML_PATH = path.join(__dirname, 'elkoplast-lozny-plan-embed.html');

function precompress(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn('⚠ File missing:', filePath);
    return null;
  }
  const raw = fs.readFileSync(filePath);
  const gzip = zlib.gzipSync(raw, { level: 9 });        // max gzip
  const brotli = zlib.brotliCompressSync(raw, {          // max brotli
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

// ── Helper: pošli předkomprimovaný buffer s ETagem ─────────────────────
function sendPrecompressed(req, res, data) {
  if (!data) { res.status(404).send('Not Found'); return; }

  // 304 Not Modified — prohlížeč už má aktuální verzi
  if (req.headers['if-none-match'] === data.etag) {
    res.status(304).end();
    return;
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', data.etag);
  // 5 minut cache + revalidate; po deployi uživatel dostane novou verzi do 5 min
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

// ── Bezpečnostní hlavičky (lehké) ──────────────────────────────────────
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── Health check ────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  app: 'elkoplast-lozny-plan',
  version: process.env.APP_VERSION || '1.0.0',
  uptime: process.uptime(),
  htmlSize: APP_DATA ? APP_DATA.size : null,
  brotliSize: APP_DATA ? APP_DATA.brotli.length : null,
  timestamp: new Date().toISOString()
}));

// ── Hlavní stránka — appka ─────────────────────────────────────────────
app.get('/', (req, res) => sendPrecompressed(req, res, APP_DATA));
app.get('/embed', (req, res) => sendPrecompressed(req, res, EMBED_DATA));

// ── Ostatní statické soubory (kdyby v budoucnu) ────────────────────────
// 1 hod cache + immutable; pro budoucí JS/CSS/img s hashy v názvu
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

// 404 fallback
app.use((_req, res) => res.status(404).send('Not Found'));

// ── Start ───────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`✓ ELKOPLAST Lozny plany v${process.env.APP_VERSION || '1.0.0'} listening on http://${HOST}:${PORT}`);
  console.log(`  Production: ${process.env.NODE_ENV === 'production' ? 'YES' : 'NO'}`);
  console.log(`  Health:     http://${HOST}:${PORT}/health`);
});

process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down...');  process.exit(0); });
