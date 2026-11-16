# BEU Syllabus API

Small Node API between the app and MongoDB Atlas. One dependency (`mongodb`).

| Route | Purpose |
| --- | --- |
| `POST /api/track` | batch of click / action events + heartbeat |
| `GET /api/stats` | `{ totalUsers, activeUsers, totalDownloads }` (cached 15 s) |
| `GET /api/health` | liveness check (does not touch the database) |

## Run locally

```bash
cd server
npm install
cp .env.example .env     # fill in MONGODB_URI
npm run dev              # http://localhost:3000
npm test                 # unit tests (in-memory stand-in, no Atlas needed)
```

For local testing set `apiBase: "http://localhost:3000"` in `js/config.js` and add that origin to `connect-src` in `index.html`.

## Deploy

**Vercel**: import the repo, set *Root Directory* to `server`, add the env vars from `.env.example`. `vercel.json` routes `/api/*` to `api/index.js`.

**Render / Railway / Fly / VPS**: build `npm install`, start `npm start`, same env vars.

Atlas: create a database user, then *Network Access* → allow the host (Vercel uses changing IPs, so `0.0.0.0/0` with a strong password).

## Notes

- Set `ALLOWED_ORIGINS` to your site (e.g. `https://mdzafar864.github.io`). Other websites get `403`.
- Anyone can still send requests to a public endpoint, so the numbers are analytics, not proof. A per-IP rate limit (`RATE_LIMIT_PER_MIN`) and strict input validation are built in.
- Changing `EVENT_TTL_DAYS` after the first run needs the old `createdAt_ttl` index dropped (or `collMod`) because Mongo will not re-create an index with different options.
