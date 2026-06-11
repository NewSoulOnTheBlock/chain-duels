# Duelmasters TCG

A turn-based card game built on **boardgame.io** that implements the full
[Yu-Gi-Oh TRADING CARD GAME rulebook (v10)](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf),
themed around 5 blockchains.

## The Five Chains (Attributes)

| Chain | YGO Attribute | Color | Identity |
|---|---|---|---|
| BnB | EARTH | orange/gold | Beasts and Plants; tribute-summon powerhouses |
| Solana | DARK | purple | Spellcasters and Fiends; burn and quick effects |
| Avalanche | FIRE | red | Pyros and Beast-Warriors; big bodies and piercing |
| Ethereum | LIGHT | white | Warriors, Fairies, Cyberse; control + ATK pump |
| XRP | WATER | black | Aqua / Sea Serpent / Reptile; disruption + counters |

## Rules summary

This game implements the **full TCG ruleset** (Main + Extra Deck monsters,
all spell/trap subtypes, chains, all summoning methods).

- **LP:** start at 8000. Drop opponent to 0 → you win. Failing to draw also
  loses (deck-out).
- **Cards:** Monsters (Normal / Effect / Fusion / Synchro / Xyz / Ritual /
  Pendulum / Link), Spells (Normal / Continuous / Equip / Field / Quick-Play /
  Ritual), and Traps (Normal / Continuous / Counter).
- **Decks:** Main Deck 40–60 cards, Extra Deck 0–15 cards, max 3 copies of
  any card.
- **Field zones (per player):**
  - 5 Main Monster Zones
  - 5 Spell/Trap Zones (leftmost/rightmost double as Pendulum Zones)
  - 1 Field Zone
  - 1 Extra Monster Zone
  - Deck, Extra Deck, Graveyard, Banished
- **Turn structure:**
  1. **Draw Phase** — draw 1 card (skipped on the first player's first turn)
  2. **Standby Phase** — resolve Standby-Phase effects
  3. **Main Phase 1** — Normal Summon/Set (once per turn), Tribute Summon
     (L5–6 needs 1, L7+ needs 2), Flip Summon, Special Summons (Fusion,
     Synchro, Xyz, Ritual, Link), activate spells, set spells/traps, change
     monster positions
  4. **Battle Phase** — declare attacks; first player cannot battle on their
     first turn
  5. **Main Phase 2** — same actions as Main Phase 1 (with once-per-turn
     limits respected)
  6. **End Phase** — resolve EP effects; discard to 6 cards
- **Battle math:**
  - ATK vs ATK: lower destroyed, controller takes the difference; equal →
    both destroyed
  - ATK vs face-up DEF: ATK > DEF defender destroyed (no damage); ATK < DEF
    attacker takes the difference; equal → nothing happens
  - Face-down attacked: flip face-up first, then compare
  - Direct attack → full ATK as damage
  - Piercing monsters inflict the (ATK − DEF) difference when attacking a
    DEF-position monster they overpower
- **Chains:** activated effects stack, resolved in reverse order. Spell speeds
  1 (normal spells, monster effects), 2 (quick-play, most traps), 3 (counter
  traps). Counter Traps may only be chained to other activations.
- **Spell/trap timing:** Traps must be Set for at least one turn before they
  can be activated. Quick-Play Spells may be Set and activated on the
  opponent's turn (not the turn they were Set).

## Card pool

Each chain has ~16 cards: 8 monsters + a balanced set of spells, traps, a
ritual pair (ritual spell + ritual monster), and one Extra Deck monster
(fusion, synchro, xyz, or link). The catalog lives in `src/cards.ts`. Each
starter Main Deck is exactly 40 cards; each starter Extra Deck has 3 copies
of that chain's signature Extra Deck monster.

## Running

### Local development (server + client with hot reload)

```bash
npm install
npm run serve        # terminal 1 — backend on :8000 (lobby + REST API + Postgres if DATABASE_URL set)
npm run dev          # terminal 2 — Vite dev server on :5173, proxies /api /games /socket.io to :8000
```

Open `http://localhost:5173` in **two different browser windows** (different
tabs/profiles work too — each uses `sessionStorage` for its own identity).
Each window logs in as a separate profile, picks a chain, creates or joins a
match in the lobby, then plays.

Without `DATABASE_URL`, profile data lives in the server's in-memory store
(resets on restart). To use Postgres locally:

```bash
$env:DATABASE_URL = "postgres://user:pass@localhost:5432/duelmasters"
npm run serve
```

## Deploying to Render.com

This repo includes a `render.yaml` blueprint that provisions one Node web
service + one free Postgres database, and wires `DATABASE_URL` automatically.

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, point at the repo, click
   **Apply**.
3. Render builds (`npm ci && npm run build`) and starts (`npm start`) the web
   service. The boardgame.io socket.io server, lobby REST API, custom
   `/api/*` profile endpoints, and the static React build are all served from
   the same port.

### Environment variables

| Var | Purpose |
|---|---|
| `PORT` | Port to listen on (Render sets this automatically). |
| `DATABASE_URL` | Postgres connection string. Without it, server uses an in-memory fallback. |
| `PGSSL` | Set to `1` to force SSL on Postgres (required on Render). |
| `ALLOW_ORIGIN` | Production origin(s) to permit for socket.io + REST connections. Accepts a single URL or a comma-separated list. |
| `VITE_SERVER_BASE` | (Build-time, optional) Override server URL the client connects to. Leave empty for same origin. |
| `VITE_API_BASE` | (Build-time, optional) Override REST API base. Leave empty for same origin. |

## Architecture

- `src/cards.ts` — card model (Monster / Spell / Trap interfaces), the full
  card catalogue, attribute ↔ chain mapping, and Main + Extra starter decks.
- `src/Game.ts` — boardgame.io `Game`: state shape, phases (draw → standby →
  main1 → battle → main2 → end), every summoning method, battle resolution,
  chain/spell-speed engine, effect handlers, `playerView` for hidden state.
- `src/Board.tsx` — React UI: YGO playmat (Monster Zones, Spell/Trap Zones,
  Field Zone, Extra Monster Zone, Graveyard, Deck), phase advance bar, hand
  selection panels, attack target picker, chain stack visualizer.
- `src/CardPreview.tsx` — large card-face preview with hover + tap-to-pin.
- `src/bot.ts` — heuristic single-player bot for the YGO rules (easy /
  normal / hard).
- `src/App.tsx` — Login → Lobby (create/join match) → MatchSeat with
  `SocketIO` multiplayer + deck builder.
- `src/server.ts` — boardgame.io `Server` (Koa) + custom `/api/*` REST API +
  static-serves the React `dist/`.
- `src/db.ts` — Postgres profile store with in-memory fallback.
- `src/profiles.ts` — client-side HTTP wrapper around the profile API.
- `render.yaml` — Render blueprint (web service + Postgres).

## Hidden information

The deck contents are stored in `G.secret.mainDecks` / `G.secret.extraDecks`
and stripped to size-only via `playerView`. Each opponent's hand becomes
`'hidden'` placeholders before being sent to your client; face-down monsters
on the opponent's side also have their `defId` masked. The framework's
authoritative master (in-browser via `Local()`, or remote via `SocketIO`) is
the only thing that ever sees the full state.

## Determinism

All shuffles and any random effects use the boardgame.io `random` API. Set a
fixed `seed` on the game object to make matches reproducible for tests.

