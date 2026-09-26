# Football Auction League

Production-ready browser football auction game with React/Vite, a Node/Express server, and WebSocket multiplayer.

## Run locally

```bash
npm install
npm run dev
```

The app and WebSocket server run from the same Node process.

## Production

```bash
npm install
npm run build
NODE_ENV=production npm start
```

The server listens on `process.env.PORT` and `0.0.0.0`.

## Cloud Run

Build the included `Dockerfile` and deploy the container to Cloud Run.

**Important:** active lobbies are intentionally stored in server memory. Until a shared database/pub-sub layer is added, deploy with **maximum instances = 1** so all WebSocket clients for a lobby share the same process.

Recommended Cloud Run settings for the current architecture:
- CPU: 1
- Memory: 512 MiB or higher
- Minimum instances: 0 for testing
- Maximum instances: 1
- WebSocket connections: enabled by default
- Allow unauthenticated invocations if the game is public

## Render / Railway / Replit

Deploy this repository as a Node service using:

```
Build: npm install && npm run build
Start: npm start
```

Do not deploy only the Vite `dist` folder. The Node server owns the REST API and WebSocket multiplayer connection.

## Multiplayer architecture

The browser connects to the same origin using:
- `wss://` when the site is HTTPS
- `ws://` when the site is HTTP

Room mutations are authoritative on the WebSocket server. Client-only localStorage is used only for reconnect information.

## Current competition modes

- League Season: Round Robin or Double Round Robin
- Knockout Cup: Round of 16, Quarter-Final, Semi-Final, Final as applicable
- Knockout ties support extra time and penalty shootouts
- Solo Play explicitly offers Start Auction or Skip Auction

## CI

Every push/PR runs:
- TypeScript check
- Vite production build
- Deterministic football-engine smoke test

## Player data

The repository currently contains a curated player subset for development. For a production FC 27 database, import a properly licensed/authorized dataset rather than inventing or scraping player data.
