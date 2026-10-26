# 11ka

Fotbalový web [11ka.cz](https://www.11ka.cz) — Express, EJS, SQLite.

## Spuštění

Potřebujete **Node.js 20** (Node 22 na macOS často rozbije `better-sqlite3`).

```bash
cp .env.example .env
# doplňte SESSION_SECRET a případně SMTP / AI klíče
npm ci
npm start
```

Web běží na http://localhost:3000. Prázdná databáze se vytvoří v `storage/` a naplní se ze `data/seed-*.json`.

## Co v gitu není

- `.env` — tajemství, zkopírujte z `.env.example`
- `storage/` — lokální SQLite (vznikne při startu)
- `node_modules/`
- `.vercel/` — vazba na konkrétní Vercel projekt
