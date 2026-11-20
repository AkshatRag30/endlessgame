# Glitch Station

Browser first social deduction game for 5 to 10 friends (3+ in practice mode with bots). The spec is [`../glitch-station-prd.html`](../glitch-station-prd.html).

**Built so far: PRD phases 0 to 6** (rooms and lobby, movement and vision, roles and tasks, the Glitch kit, meetings and voting, polish and rematch) plus practice bots pulled forward from phase 9. Phases 7 (soft launch tooling) and 8 (wallet identity and NFT cosmetics) are not built.

Guides in [`docs/`](docs/): [player walkthrough](docs/player-guide.html), [builder guide](docs/builder-guide.html), [deployment guide](docs/deployment-guide.html).

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Everything both sides must agree on: `config.ts` (every tunable number), the map and collision grid, movement, tasks, rules (roles, votes, wins, chat filter), the wire protocol and its validators. |
| `apps/server` | One Cloudflare Worker. `index.ts` routes `/api/rooms`, `/ws`, `/health` and serves the built client. `room.ts` is the per room Durable Object (lobby, sockets, reconnect). `match.ts` is the authoritative simulation. `bots.ts` are practice bots. |
| `apps/client` | Vite + TypeScript + Phaser 3. `scenes/StationScene.ts` draws the world with prediction, interpolation and vision. `ui/` is the HTML overlay (home, lobby, HUD, meeting, results). `tasks/minigames.ts` has the 8 tasks and 2 fix games. |
| `scripts/` | `smoke.mjs` end to end check, `fake-players.mjs` 9 player load test, `ensure-dist.mjs` dev helper. |

## Run locally

```sh
npm install
npm run dev
```

Open the `Local:` address Vite prints (http://localhost:5173). Phones on the same WiFi use the `Network:` address. Create a room, share the code, and for a small group turn on **Practice mode** and **Add bot** in the lobby.

## Checks

```sh
npm run lint     # ESLint + strict typecheck of all packages
npm test         # 33 unit and simulation tests (rules, anti cheat, full bot matches)
npm run smoke    # with npm run dev running: 5 headless players play the opening of a match
npm run bots -- ABCD   # fill room ABCD with 9 network fake players
```

## Deploy (free)

```sh
npx wrangler login     # once
npm run deploy         # builds the client and deploys one Worker
```

You get `https://glitch-station.<your-subdomain>.workers.dev`, which serves the game and the room servers together. **No env file is needed.** Full steps, optional settings and troubleshooting: [docs/deployment-guide.html](docs/deployment-guide.html).
