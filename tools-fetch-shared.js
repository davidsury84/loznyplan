// Diagnostika: stáhne /api/shared z produkce přes SSO token ze secretu v env.
// Spouštět: railway run node tools-fetch-shared.js  (secret se NIKDY nevypisuje)
const crypto = require('crypto');
const SECRET = (process.env.INTRANET_SSO_SECRET || '').trim();
if (!SECRET) { console.error('Chybí INTRANET_SSO_SECRET v env — spusť přes `railway run`.'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const data = b64url(JSON.stringify({ email: 'david.sury@elkoplast.cz', name: 'Diagnostika', exp: Date.now() + 5 * 60 * 1000 }));
const tok = data + '.' + crypto.createHmac('sha256', SECRET).update('sso:' + data).digest('hex').slice(0, 32);
fetch('https://loznyplan-production.up.railway.app/api/shared?sso=' + encodeURIComponent(tok))
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(j => {
    require('fs').writeFileSync(process.argv[2] || 'shared-dump.json', JSON.stringify(j, null, 2));
    console.log('OK: verze', j.version, '—', (j.boxTypes || []).length, 'typů,', (j.orders || []).length, 'objednávek');
  })
  .catch(e => { console.error('Chyba:', e.message); process.exit(1); });
