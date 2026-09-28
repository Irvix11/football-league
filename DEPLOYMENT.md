# Football Auction League — production deployment

## Oracle VM (primary)

Production runs on a single Oracle Cloud VM with Nginx terminating HTTPS and proxying HTTP/WebSocket traffic to the Node realtime server on localhost.

Production URL:

`https://footballleague.runs-on.dev`

The free runs-on.dev hostname points its A record at the Oracle VM. The VM obtains and renews the Let's Encrypt certificate with Certbot.

### Required configuration

- Node.js: **24.x**
- Nginx: public HTTP/HTTPS reverse proxy
- Node realtime server: **127.0.0.1:3000**
- Frontend and realtime backend share the same HTTPS origin
- GitHub Actions deploys `main` to the VM over SSH

### Persistence

Active room state lives in the Node process for low-latency gameplay and is snapshotted to Supabase for reconnect/recovery.

Set these server-only values:

```
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Never expose `SUPABASE_SECRET_KEY` with a `VITE_*` variable.

### Optional AI

The tactical assistant is server-side only.

```
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openrouter/auto
OPENROUTER_SITE_URL=https://footballleague.runs-on.dev
```

### WebSocket origins

The production frontend is same-origin:

`https://footballleague.runs-on.dev`

Additional browser origins must be explicitly added through `ALLOWED_WS_ORIGINS`.

### Health check

`GET /api/health` returns the server status.

### Local production test

```bash
npm install
npm run build:full
npm run smoke
NODE_ENV=production npm start
```

## Legacy hosting files

`vercel.json`, `api/*`, `Dockerfile`, and `render.yaml` remain in the repository for compatibility/experimentation, but they are **not** the production deployment path.

For multiplayer reliability, do not run multiple independent Node realtime instances without adding shared realtime state/pub-sub coordination.

## Release checklist

1. CI passes.
2. VM deployment passes.
3. `https://footballleague.runs-on.dev` loads.
4. WebSocket connection succeeds.
5. Create/join lobby works from two browsers/devices.
6. Auction completes and produces exactly 11-player squads.
7. Team management validates formations/tactics/roles server-side.
8. Every league fixture can be played through the 2D live engine.
9. Mid-season transfer window opens and closes correctly.
10. Knockout fixtures can be played through every round.
11. Season end/awards render and completed room snapshots are removed.
