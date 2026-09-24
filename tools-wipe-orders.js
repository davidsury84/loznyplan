// Jednorázový úklid sdíleného úložiště: smaže VŠECHNY objednávky a plány
// v historii a založí na ně náhrobky (deletedOrders/deletedHistory), aby je
// klienti se starou lokální kopií nemohli syncem vrátit.
// Typy beden, vozidla, tým a log aktivit ZŮSTÁVAJÍ.
// Spouštět: railway run node tools-wipe-orders.js   (secret se nevypisuje)
const crypto = require('crypto');
const fs = require('fs');
const BASE = 'https://loznyplan-production.up.railway.app';
const SECRET = (process.env.INTRANET_SSO_SECRET || '').trim();
if (!SECRET) { console.error('Chybí INTRANET_SSO_SECRET v env — spusť přes `railway run`.'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function ssoToken() {
  const data = b64url(JSON.stringify({ email: 'david.sury@elkoplast.cz', name: 'Úklid objednávek', exp: Date.now() + 5 * 60 * 1000 }));
  return data + '.' + crypto.createHmac('sha256', SECRET).update('sso:' + data).digest('hex').slice(0, 32);
}
(async () => {
  const res = await fetch(BASE + '/api/shared?sso=' + encodeURIComponent(ssoToken()));
  if (!res.ok) throw new Error('GET HTTP ' + res.status);
  const data = await res.json();
  const backup = 'zaloha-shared-pred-uklidem-' + new Date().toISOString().slice(0, 10) + '.json';
  fs.writeFileSync(backup, JSON.stringify(data, null, 2));
  const orderIds = (data.orders  || []).map(o => o.id);
  const histIds  = (data.history || []).map(h => h.id);
  console.log('Záloha:', backup);
  console.log('Mažu:', orderIds.length, 'objednávek,', histIds.length, 'plánů v historii.');
  console.log('Nechávám:', (data.boxTypes || []).length, 'typů beden,', (data.fleet || []).length, 'vozidel,', (data.team || []).length, 'členů týmu.');
  const uniq = (a) => Array.from(new Set(a));
  const put = await fetch(BASE + '/api/shared?sso=' + encodeURIComponent(ssoToken()), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boxTypes: data.boxTypes || [], fleet: data.fleet || [],
      orders: [], history: [],
      team: data.team || [], activity: data.activity || [],
      deletedOrders:  uniq([...(data.deletedOrders  || []), ...orderIds]),
      deletedHistory: uniq([...(data.deletedHistory || []), ...histIds]),
      modifiedBy: 'úklid — smazání objednávek a historie'
    })
  });
  if (!put.ok) throw new Error('PUT HTTP ' + put.status);
  const out = await put.json();
  console.log('Hotovo: verze', out.version, out.persisted ? '(persistováno)' : '⚠ NEpersistováno');
})().catch(e => { console.error('Chyba:', e.message); process.exit(1); });
