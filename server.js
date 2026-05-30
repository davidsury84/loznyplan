/**
 * ELKOPLAST — Ložné plány
 * Production HTTP server for Railway / Heroku / VPS
 *
 * - Serves the single-file HTML app (lozny-plan-v3-stohovani.html)
 * - Health check endpoint at /health
 * - Listens on process.env.PORT (Railway requirement)
 */

const express = require('express');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ── Middleware ──────────────────────────────────────────────────────────
app.use(compression());          // gzip — HTML app je ~750 kB, gzip ho srazí na ~180 kB
app.disable('x-powered-by');

// Bezpečnostní hlavičky (základní set, žádný extra balíček)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Povolit embed do iframe ze stejné domény (default). Pro embed z jiné domény uprav:
  // res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://intranet.elkoplast.cz");
  next();
});

// ── Health check (Railway / load balancer) ─────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  app: 'elkoplast-lozny-plan',
  version: process.env.APP_VERSION || '1.0.0',
  uptime: process.uptime(),
  timestamp: new Date().toISOString()
}));

// ── Hlavní stránka — appka ─────────────────────────────────────────────
const APP_HTML = path.join(__dirname, 'lozny-plan-v3-stohovani.html');
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');   // vždy nejnovější verze
  res.sendFile(APP_HTML);
});

// Embed wrapper (volitelně, pro iframe)
app.get('/embed', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'elkoplast-lozny-plan-embed.html'));
});

// Statické soubory (kdyby v budoucnu bylo třeba — obrázky, fonty)
app.use(express.static(__dirname, {
  index: false,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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

// Graceful shutdown (Railway sends SIGTERM)
process.on('SIGTERM', () => { console.log('SIGTERM received, shutting down...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('SIGINT received, shutting down...');  process.exit(0); });
