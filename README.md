# ELKOPLAST — Ložné plány v1.0

Webová aplikace pro plánování ložného uspořádání kontejnerů a beden ve vozidlech, generování přepravenek a optimalizaci vytížení vozů.

Aplikace má **dva komponenty**:

1. **Frontend** — jediný HTML soubor `lozny-plan-v3-stohovani.html` (~750 kB) s celou logikou v JS, funguje i offline.
2. **Backend** — minimální Express server (`server.js`) pro hostování na **Railway** / Heroku / VPS. Server jen servíruje statický HTML soubor, žádná databáze není potřeba (data se ukládají v `localStorage` prohlížeče).

---

## Soubory v repu

| Soubor | K čemu |
|---|---|
| `lozny-plan-v3-stohovani.html` | **Hlavní aplikace** — celá funkčnost v jednom souboru |
| `server.js` | Express HTTP server pro produkci |
| `package.json` | Node dependencies (`express`, `compression`) |
| `railway.json` | Railway konfigurace (health check, restart policy) |
| `Dockerfile` | Alternativa k Nixpacks pro Railway / jiné Docker hosty |
| `.dockerignore`, `.gitignore` | Výjimky pro Docker / git |
| `elkoplast-lozny-plan-embed.html` | Wrapper pro embed do iframe |
| `build-offline.js` | Node skript, který vyrobí plnou offline verzi (inline THREE.js, XLSX, Leaflet) |
| `README.md` | Tento soubor |

---

## 🚄 Nasazení na Railway (doporučený postup)

### Postup krok za krokem

1. **Vytvořte si účet** na [railway.app](https://railway.app) (GitHub login).

2. **Inicializujte Git repozitář** v adresáři s těmito soubory:

   ```bash
   cd /path/to/elkoplast-lozny-plan
   git init
   git add .
   git commit -m "Initial production deployment v1.0.0"
   ```

3. **Pushněte na GitHub** (vytvořte nový repo, např. `elkoplast/lozny-plan`):

   ```bash
   git remote add origin git@github.com:elkoplast/lozny-plan.git
   git push -u origin main
   ```

4. **V Railway dashboardu**:
   - Klikněte **„New Project"** → **„Deploy from GitHub repo"**
   - Vyberte právě nahraný repo
   - Railway automaticky:
     - Detekuje Node.js
     - Stáhne závislosti (`npm install`)
     - Spustí `npm start`
     - Přidělí HTTPS doménu typu `lozny-plan-production.up.railway.app`

5. **Custom doména** (volitelně):
   - Settings → Networking → **Custom Domain**
   - Přidejte např. `lozny.elkoplast.cz`
   - Nastavte CNAME v DNS svého poskytovatele dle instrukcí Railway

### Environment variables (volitelné)

V Railway dashboardu → Variables → přidejte:

| Variable | Default | Popis |
|---|---|---|
| `NODE_ENV` | `production` | Doporučeno pro produkci (Express optimalizace) |
| `PORT` | _auto_ | Railway nastaví automaticky, **neměňte ručně** |
| `APP_VERSION` | `1.0.0` | Zobrazí se v `/health` endpointu |

### Aktualizace aplikace

```bash
git add lozny-plan-v3-stohovani.html
git commit -m "v1.0.1 — bugfix"
git push
```

Railway **automaticky redeployne** při každém pushi do `main` větve. Žádné restartování ručně.

### Health check

Po deployi otestujte:

```
https://lozny.elkoplast.cz/health
```

Mělo by vrátit:

```json
{
  "status": "ok",
  "app": "elkoplast-lozny-plan",
  "version": "1.0.0",
  "uptime": 123.45,
  "timestamp": "2026-05-29T10:15:00.000Z"
}
```

---

## 💻 Lokální vývoj

```bash
# Instalace závislostí (jen poprvé)
npm install

# Spuštění
npm start
# nebo pro dev (s NODE_ENV=development)
npm run dev
```

Aplikace běží na `http://localhost:3000`.

---

## 🐳 Docker (alternativa)

Pokud preferujete Docker (Railway umí oboje — Nixpacks i Dockerfile):

```bash
# Build
docker build -t elkoplast-lozny-plan .

# Run
docker run -p 3000:3000 -e NODE_ENV=production elkoplast-lozny-plan
```

Pokud existuje `Dockerfile`, Railway ho **upřednostní** před Nixpacks.

---

## 🌐 Embed do firemního webu

```html
<iframe src="https://lozny.elkoplast.cz/embed"
        style="width:100%;height:1100px;border:0;"
        allow="clipboard-read; clipboard-write">
</iframe>
```

**Důležité — HTTP hlavičky:**
- Server **neposílá** restriktivní `X-Frame-Options` ani `frame-ancestors`, takže iframe funguje z libovolné domény.
- Pokud chcete omezit, kdo může embedovat, odkomentujte v `server.js`:
  ```javascript
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://intranet.elkoplast.cz");
  ```
- Pro stejnou doménu (same-origin) je `localStorage` sdílený s parent stránkou.

---

## 📴 Offline / standalone verze

Pro plně offline použití (USB flash, e-mail, lokální share) spusťte:

```bash
node build-offline.js
```

Skript inlinuje všechny externí závislosti (THREE.js, XLSX, Leaflet, fonty) a vytvoří soubor `lozny-plan-OFFLINE.html`. **Pozn.:** Mapa rozvozu (OSM tiles), adresové autocomplete (Nominatim) a routing (OSRM) vyžadují připojení — vše ostatní funguje 100% offline.

---

## ⚙️ Produkční vs vývojářský režim

V hlavičce `lozny-plan-v3-stohovani.html` je konstanta:

```javascript
const IS_PRODUCTION = true;   // produkce — vývojářské nástroje skryté
const APP_VERSION = '1.0.0';
```

Při `IS_PRODUCTION = true` jsou v UI **skryty**:
- Menu **„🔬 Testy a vývoj"** (testovací engine, historie expedic, stress test, trenér skládání, log akcí)
- Záložka **„⚡ Stress test"**
- V patičce se zobrazí číslo verze: `ELKOPLAST · Ložné plány v1.0.0`

Pro vývoj přepněte na `false`.

---

## 🎯 Funkce v1.0

### Pro uživatele
- **Zadávání zakázek** — boxové typy s rozměry a hmotností, objednávky s vykládkami
- **Import z Excelu** — hromadné načtení z `.xlsx` / `.csv`
- **Algoritmus optimalizace** — 8 variant balení (A–J)
- **Půdorys 2D + 3D pohled** — interaktivní vizualizace
- **Ruční úprava plánu** — otočit, vnořit, odložit, znovu umístit bedny
- **Generování přepravenky PDF** s logem ELKOPLAST, 2D + 3D snímky
- **Odeslání e-mailem** — stáhne `.eml` soubor s kompletní přepravenkou v těle
- **Historie zakázek** — lokální uložení až 30 plánů, export/import JSON

### Pro správce (v dev režimu)
- Testovací engine, Historie expedic, Stress test, Trenér skládání, Log akcí

---

## 🔧 Údržba

| Operace | Postup |
|---|---|
| Aktualizovat appku | `git push` → Railway auto-deploy |
| Vrátit zpět verzi | Railway dashboard → **Deployments** → klik na starší deploy → **Redeploy** |
| Logy z produkce | Railway dashboard → **Deployments** → **View Logs** |
| Změnit verzi | Upravit `APP_VERSION` v `lozny-plan-v3-stohovani.html` a `package.json` |
| Custom doména | Railway → Settings → Networking → Custom Domain |
| Vypnout vývoj. nástroje | `IS_PRODUCTION = true` v HTML souboru |

---

## 💰 Náklady na Railway

- **Hobby plan**: $5/měsíc kredit, stačí pro testovací nasazení
- **Pro plan**: $20/měsíc, doporučeno pro produkci
- Tato aplikace má **minimální zátěž** (statické servírování HTML), spotřeba bude < $5/měsíc i pro 100 uživatelů denně

---

## 📞 Kontakt

ELKOPLAST CZ s.r.o.  
Zlínský kraj, Česká republika

---

## 📋 Verze

**v1.0.0** (2026-05-29)
- První produkční vydání pro Railway
- Algoritmus optimalizace (A–J varianty se stohováním a vnořováním)
- Půdorys 2D + 3D pohled vedle sebe
- Přepravenka PDF + odeslání e-mailem (.eml)
- Import Excel s slučováním typů beden
- Historie zakázek (lokální + export/import JSON)
- Ruční úprava plánu (otočit/vnořit/odložit)
- Logo ELKOPLAST inline
- Express server pro Railway / Docker
