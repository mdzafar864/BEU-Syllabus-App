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

**Vercel**: import the repo, set *Root Directory* to `server`, add the env vars from `.env.example` (see [Deployment optimizations](#deployment-optimizations) for the values used in production). Each route is its own file in `api/` (`health.js`, `stats.js`, `track.js`), so no rewrite config is needed.

**Render / Railway / Fly / VPS**: build `npm install`, start `npm start`, same env vars.

Atlas: create a database user, then *Network Access* → allow the host (Vercel uses changing IPs, so `0.0.0.0/0` with a strong password).

## Deployment optimizations

The production deployment (Vercel + Atlas) is tuned to keep database connections, function invocations and API calls low. These are the settings in use and why.

### Server settings

| Setting | Value | Where | Why |
| --- | --- | --- | --- |
| `ACTIVE_WINDOW_MINUTES` | `3` | Vercel environment variable | A visitor counts as "active" if their last heartbeat was within the last 3 minutes. With a 20 s heartbeat this tolerates a few missed beats while keeping the active-user count close to real time. |
| `AUTO_SEED` | `false` | Vercel environment variable | Skips the start-up database check on every cold start, saving several round trips to Atlas per serverless instance. The database is already set up, so seeding is not needed. |
| `minPoolSize` | `0` | `db.js` (MongoClient options) | No idle connections are held open. Serverless instances scale to zero, and idle sockets would only use up Atlas connection slots. |
| `maxPoolSize` | `2` | `db.js` (MongoClient options) | Each serverless instance handles few concurrent requests, so a small pool is enough. It also keeps total connections low when many instances run at once, which matters on the Atlas free tier (connection limit). |

Notes:

- With `AUTO_SEED=false` the collections, indexes and default documents are **not** checked on start-up. Run `npm run seed` by hand after pointing the API at a new or empty database (or temporarily set `AUTO_SEED=true`).
- Changing any environment variable on Vercel requires a redeploy before it takes effect.

### Cold-start / donate-latency settings

| Setting | Value | Where | Why |
| --- | --- | --- | --- |
| `regions` | `["bom1"]` | `vercel.json` | Runs the functions in Mumbai instead of the default Washington DC (`iad1`). **Must match your Atlas cluster region** (AWS Mumbai / `ap-south-1`); if the cluster is elsewhere, change this to the nearest Vercel region to it. |
| `fluid` | `true` | `vercel.json` | Fluid compute: bytecode caching, instance reuse and pre-warming. Already the default for projects created after 23 Apr 2025; this makes it explicit for older ones. |
| Razorpay client | built-in `fetch` | `src/razorpay-lite.js` | The `razorpay` npm package (axios etc.) is no longer loaded on cold start. |
| `GET /api/create-order?warm=1` | - | `src/payments.js` | Called by the page when a donor shows interest; wakes the function and the Atlas connection before they press Donate. Counts as one invocation. |

Tip: in Atlas, use the **standard** connection string (`mongodb://host1,host2,host3/...`) instead of `mongodb+srv://` to skip the SRV/TXT DNS lookups on every cold connect.

### Client timer settings (stable timers)

The front end uses fixed, stable timers so the number of API calls per visitor stays predictable:

| Setting | Value | Purpose |
| --- | --- | --- |
| `heartbeatMs` | `20000` (20 seconds) | How often the app sends a heartbeat to `POST /api/track`. |
| `statsRefreshMs` | `10000` (10 seconds) | How often the app refreshes numbers from `GET /api/stats`. |

How this reduces API calls:

- **Heartbeat**: one call every 20 s is 3 calls per minute per visitor, instead of 6 per minute at 10 s. Combined with the 3-minute active window, a visitor stays "active" even if several heartbeats are missed.
- **Stats refresh**: the server caches `/api/stats` for 15 s, so polling every 10 s means roughly every other request is served from the cache and does not touch MongoDB.
- **Stable intervals**: the timers are fixed values (no rapid retries or restarts on every interaction), so load grows linearly with visitors and does not spike.
- Events (clicks / actions) are sent in batches rather than one request per event.

Keep `ACTIVE_WINDOW_MINUTES` comfortably larger than `heartbeatMs` (3 minutes = 180 s versus 20 s). If you lengthen the heartbeat, increase the active window to match.

## Automatic database setup (seeding)

On start-up (first request of each serverless instance, or when `npm start` connects) the API checks the database and creates whatever is missing: the `events`, `visitors`, `counters` and `meta` collections, their indexes, and two default documents (`counters/downloads` = 0 and `meta/schema` = version 1).

- **Safe to repeat**: it only adds what is missing and never overwrites existing data, so it works on an empty, partly set-up or fully populated database, and when several instances start at once.
- **Never fatal**: if seeding fails (for example the database user may not create collections) it is logged as `[seed] skipped` and the API keeps working, because every write upserts.
- **Switch off** with `AUTO_SEED=false` (the production setting, see [Deployment optimizations](#deployment-optimizations)). **Run by hand** with `npm run seed` (prints what it created).

## Notes

- Set `ALLOWED_ORIGINS` to your site (e.g. `https://mdzafar864.github.io`). Other websites get `403`.
- Anyone can still send requests to a public endpoint, so the numbers are analytics, not proof. A per-IP rate limit (`RATE_LIMIT_PER_MIN`) and strict input validation are built in.
- Changing `EVENT_TTL_DAYS` after the first run needs the old `createdAt_ttl` index dropped (or `collMod`) because Mongo will not re-create an index with different options.
