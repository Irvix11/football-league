# Football Auction League

A production-focused real-time football auction and league game with multiplayer lobbies, solo AI, live positional auctions, 11-player tactical squads, transfers, a seeded 2D match engine, knockout competitions and season awards.

## Production stack

- **Frontend:** React + Vite
- **Realtime:** Node/Express + WebSocket
- **Hosting:** Vercel Fluid Compute
- **Persistence:** Supabase room snapshots
- **Runtime:** Node 24
- **Player database:** 510 FC27 players rated 80+ in the checked-in generated dataset, plus 200 curated all-time players

## Run locally

Requirements: Node.js 24+.

```bash
npm install
npm run build:full
npm run smoke
npm start
```

Open the address printed by the server. The Node/Express server hosts the React build and WebSocket game server from the same origin.

## Vercel deployment

Push to the `main` branch and let the Vercel project deploy the repository using `vercel.json`.

The production build command is:

```bash
npm run build
```

The realtime WebSocket endpoint is served from `/api/ws`. Durable room snapshots are written to Supabase so reconnects can recover across function instances.

## Development

```bash
npm run dev
npm run build:full
npm run smoke
```

## Player data

The checked-in FC27 generated dataset contains **510 players rated 80+** from the imported ratings snapshot used by this project. The separate all-time dataset contains **200 curated players**.

The import tooling lives in `scripts/import-fc27.ts` and writes `src/data/fc27.generated.ts`.

For official EA SPORTS FC ratings information, see:
https://www.ea.com/games/ea-sports-fc/ratings

## Release checks

Before shipping a release, verify:

1. `npm run build:full`
2. `npm run smoke`
3. Vercel deployment is **READY**
4. Production runtime logs show no new errors
5. A fresh browser can create/join a lobby, reconnect, run an auction, confirm an 11-player XI, simulate a match, and complete a knockout match




<!-- release trigger: auction-economy-and-formation-fixes 2026-09-27 -->


<!-- release trigger: zero-value-and-crash-hardening 2026-09-27 -->


<!-- deploy: final-zero-price-crash-hardening-2026-09-27 -->




## League Rules

- Every manager plays every other manager twice: once home and once away.
- 2–5 managers: top 2 advance to the Final.
- 6–9 managers: top 4 advance to the Semi-Finals.
- 10–16 managers: top 8 advance to the Quarter-Finals.
- Knockout draws are decided by extra time and then a visual penalty shootout.
- Semi-Finals are followed by a Third-Place match, then the Final.

<!-- vercel-force-deploy: 2026-09-27T19:58 -->

<!-- force-vercel: 1790519815791 -->

<!-- harmless production deployment trigger: 2026-09-27 -->
