# Football Auction League

A real-time browser football auction and league game with multiplayer lobbies, solo AI, live auctions, team management, a seeded match simulation engine, animated 2D matches, transfers, knockout stages and season awards.

## Run locally

Requirements: Node.js 22+.

```bash
npm install
npm run build:full
npm start
```

Open the address printed by the server. The Node/Express server hosts the React build and the WebSocket game server from the same origin.

## Deploy on Render

This repository includes `render.yaml` and a Dockerfile.

1. Create a new Web Service in Render from this GitHub repository.
2. Let Render use the repository Dockerfile.
3. Deploy.
4. Share the generated HTTPS URL with friends.

The game uses WebSockets, so deploy it as a long-running web service rather than a static-site deployment.

## Development

```bash
npm run dev
npm run build:full
npm run smoke
```

## Player data

The checked-in `src/data/players.ts` file is a small development dataset and is **not** the complete EA SPORTS FC 27 database. The game is structured so a properly licensed/authorized FC 27 data import can replace it without changing the auction or simulation engine.

EA SPORTS FC 27's official ratings database is maintained by EA: https://www.ea.com/games/ea-sports-fc/ratings


<!-- production-deploy-trigger -->

<!-- Vercel deployment trigger: 2026-09-27T10:37:54.677Z -->

<!-- FORCE VERCEL REDEPLOY: 2026-09-27T2026-09-27T10:52:57.798Z -->

<!-- deployment trigger: knockout websocket fix -->











<!-- force-deploy-1790507484915 -->
