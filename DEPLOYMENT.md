# Football Auction League — production deployment

## Vercel (primary)

The production app is designed for Vercel with Fluid Compute.

### Required configuration

- Node.js: **24.x**
- Build command: `npm run build`
- `vercel.json` enables Fluid Compute and configures the API function duration.
- WebSocket endpoint: `/api/ws`
- REST API: `/api/*`

The browser and realtime server should use the same origin in production.

### Persistence

Active room state lives in the Node process for low-latency gameplay and is snapshotted to Supabase for reconnect/recovery.

Set:

```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
```

### Optional AI

The tactical assistant is server-side only.

```
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openrouter/auto
OPENROUTER_SITE_URL=https://football-league-nine.vercel.app
```

### WebSocket origins

For same-origin production hosting, no custom origin override is normally required. When using a separate frontend, set:

```
ALLOWED_WS_ORIGINS=https://example.com
```

### Health check

`GET /api/health` returns the server status and current active-room count.

## Local production test

```bash
npm install
npm run build:full
npm run smoke
NODE_ENV=production npm start
```

## Docker / Render fallback

The repository still contains a Dockerfile and `render.yaml` for a long-running Node deployment. Use that architecture when you need a single persistent Node instance outside Vercel.

For multiplayer reliability, do not run multiple independent Node instances without adding a shared realtime state/pub-sub layer.
