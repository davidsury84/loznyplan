// Jednorázová oprava: duplicitní ID typů beden ve sdíleném úložišti.
// Pozdější výskyt každého kolizního ID dostane nové unikátní ID (max+1…);
// reference v objednávkách zůstávají na původním (prvním) typu.
// Spouštět: railway run node tools-fix-shared-ids.js   (secret se nevypisuje)
const crypto = require('crypto');
const BASE = 'https://loznyplan-production.up.railway.app';
const SECRET = (process.env.INTRANET_SSO_SECRET || '').trim();
if (!SECRET) { console.error('Chybí INTRANET_SSO_SECRET v env — spusť přes `railway run`.'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function ssoToken() {
  const data = b64url(JSON.stringify({ email: 'david.sury@elkoplast.cz', name: 'Oprava ID typů', exp: Date.now() + 5 * 60 * 1000 }));
  return data + '.' + crypto.createHmac('sha256', SECRET).update('sso:' + data).digest('hex').slice(0, 32);
}
(async () => {
  const res = await fetch(BASE + '/api/shared?sso=' + encodeURIComponent(ssoToken()));
  if (!res.ok) throw new Error('GET HTTP ' + res.status);
  const data = await res.json();
  const types = data.boxTypes || [];
  let maxId = Math.max(0, ...types.map(t => +t.id || 0));
  const seen = new Set(); const changes = [];
  for (const t of types) {
    if (seen.has(+t.id)) { const old = t.id; t.id = ++maxId; changes.push(`${t.name}: ${old} → ${t.id}`); }
    else seen.add(+t.id);
  }
  if (!changes.length) { console.log('Žádné duplicitní ID — nic k opravě (verze', data.version, ').'); return; }
  console.log('Opravy:\n  ' + changes.join('\n  '));
  const put = await fetch(BASE + '/api/shared?sso=' + encodeURIComponent(ssoToken()), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boxTypes: types, fleet: data.fleet || [], orders: data.orders || [],
      team: data.team || [], activity: data.activity || [], history: data.history || [],
      modifiedBy: 'oprava duplicitních ID typů'
    })
  });
  if (!put.ok) throw new Error('PUT HTTP ' + put.status);
  const out = await put.json();
  console.log('Uloženo: verze', out.version, out.persisted ? '(persistováno)' : '⚠ NEpersistováno');
})().catch(e => { console.error('Chyba:', e.message); process.exit(1); });
