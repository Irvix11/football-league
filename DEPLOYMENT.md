# Football Auction League — production deployment

Football Auction League is a React/Vite frontend served by the same long-running Node/Express process that owns the WebSocket multiplayer server.

## Recommended architecture

- GitHub: source code
- One long-running Node host: frontend + REST API + WebSocket server
- Supabase: durable room snapshots/database
- Optional separate static frontend: set `VITE_GAME_SERVER_URL` to the game-server origin

Keeping the frontend and game server on one origin is the simplest setup and avoids CORS and WebSocket routing problems.

## Production commands

`npm install`
`npm run build:full`
`NODE_ENV=production npm start`

The server listens on `process.env.PORT` and `0.0.0.0`.

## Docker

The included `Dockerfile` uses Node 24, builds the Vite frontend, and starts the production Node server on port 8080. A hosting provider may override `PORT` automatically.

## Important multiplayer requirement

The current game keeps active room state in the Node process and persists snapshots to Supabase. Run the game server as **one long-lived instance** unless a shared realtime state/pub-sub layer is added. Multiple independent Node instances can split WebSocket room state.

## Reverse proxy

If the host provides a VM, put Nginx/Caddy in front of the Node process and proxy both HTTP and WebSocket traffic to the same Node port. HTTPS must terminate at the proxy so browsers can use `wss://`.

## Health check

`GET /api/health` returns the server status and active room count.

## CI

Every push/PR runs the TypeScript check, Vite production build, and deterministic football-engine smoke test.

## Hosting

The game no longer depends on Vercel-specific API functions. Deploy the repository as a normal long-running Node service or Docker container.
