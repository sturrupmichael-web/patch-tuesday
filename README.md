# PATCH TUESDAY 🚀🔥

A Jackbox-style party game about pushing changes to prod. One laptop on the
conference-room screen is the **host**; 2–6 players join on their **phones**.

Every change you deploy moves your server further down its Deployment Pipeline,
where the rewards get bigger. But your Backlog is full of Bugs, and if your Bugs
add up to more than 7, **PROD GOES DOWN**. Deploy as far as you dare, then hit
**SHIP IT**. Nine change windows later, the sysadmin with the most Uptime Points
is Employee of the Month.

## How to play (60-second version)

1. **CAB Notice:** each change window opens with a stamped memo that bends the rules (Read-Only Friday, Vendor Sale, Change Freeze…).
2. **Tech Debt Relief:** players behind the leader get a head start.
3. **Deploying (everyone at once):** tap DEPLOY to draw a random change from your backlog. Tap SHIP IT to stop. Bugs over 7 = PROD DOWN. You have one **Rollback** to put back a Bug you just drew (recharge it for 3 ☕).
4. **Post-Incident Review:** the furthest player still up rolls the Kudos Die. Change effects score. Up = take the Budget **and** the UP for your space. Down = fix it ($) **or** explain it (UP), not both.
5. **Vendor Portal:** spend Budget on up to 2 changes of different types. Unspent Budget is lost (use it or lose it). Spend Coffee on a Rollback recharge (3 ☕) or a process improvement (2 ☕, start 1 space further forever).

After round 9, leftover $5 → 1 UP and 2 ☕ → 1 UP.

| Change | Values | Effect |
| --- | --- | --- |
| 🐛 Bug | 1/2/3 | Danger. Bug points over 7 = PROD DOWN |
| 🩹 Hotfix | 1/2/4 | +1 ☕ if it's your last or second-to-last change |
| 📜 Script | 1 | Cheap, no effect |
| 🔍 Log Review | 1/2/4 | Peek at that many changes; deploy one or none |
| 🧪 Unit Test | 1/2/4 | If the previous change was a Bug, send it back to the backlog |
| 🤖 Automation | 1/2/4 | +1 space per Script already deployed (max +2). Unlocks round 2 |
| 🕶️ Shadow IT | 1 | Beat one neighbor's count = +1 space; both = +1 space +1 ☕. Unlocks round 2 |
| 👔 Exec Sponsor | 1 | 1/2/3+ deployed = +1 UP / +1 UP +1 ☕ / +2 UP + free Script. Unlocks round 3 |

All numbers (prices, pipeline, CAB notices, Kudos Die faces) live in
[`src/engine/data.ts`](src/engine/data.ts) for easy rebalancing.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173/patch-tuesday/host/  and  /patch-tuesday/
npm test           # rules-engine unit tests (vitest)
npm run e2e        # full 9-round browser smoke test (needs `npm run dev` running and `npx playwright` available)
npm run build      # type-check + static build into dist/
```

Without Supabase env vars the game runs in **local mode**: it talks over the
browser's `BroadcastChannel`, so the host and the "phones" must be tabs of the
same browser. Each tab gets its own seat. That's the quickest way to hack on it.

**Solo testing / dev mode:** open the host with `?dev`
(`/patch-tuesday/host/?dev`). The lobby gets an **Add dev bot** button, so you
can fill the table with bots and play one phone tab against them. Add
`&seed=1234` to replay the exact same backlog draws and CAB notices.

To test with real phones on your Wi-Fi, set up Supabase (below) and open
`http://<your-laptop-ip>:5173/patch-tuesday/host/`; the QR code points phones at
that address.

## Supabase setup (realtime)

No database tables are needed; the game only uses Realtime **broadcast**.

1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine).
2. In **Project Settings → API**, copy the project URL and the **anon / publishable** key.
3. Copy `.env.example` to `.env.local` and fill them in:

   ```bash
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Make sure Realtime is enabled for the project (it is by default). If you
   turned on "private channels only" in Realtime settings, turn it off for this
   game, since rooms use public broadcast channels named `patch-tuesday:<CODE>`.

The anon key is designed to be public and ends up in the static bundle. Never
put a `service_role` key here.

## Deploying under `/patch-tuesday/`

The Vite `base` is `/patch-tuesday/` (override with `VITE_BASE=/other/ npm run build`).

```bash
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build
```

Upload the contents of `dist/` to the `patch-tuesday/` folder of the site, so you get:

- `michaelsturrup.com/patch-tuesday/` → phone join screen (`dist/index.html`)
- `michaelsturrup.com/patch-tuesday/host/` → host screen (`dist/host/index.html`)

Most static hosts (Netlify, Vercel, Cloudflare Pages, S3/CloudFront, nginx)
serve `/patch-tuesday/host` as `/patch-tuesday/host/index.html` automatically
or redirect to the trailing-slash URL. No SPA rewrites are needed.

## Architecture

```
src/engine/   Pure rules engine: data.ts (balance), engine.ts (reduce), bot.ts, rng.ts
src/net/      Wire protocol + transport (Supabase Realtime, or BroadcastChannel locally)
src/host/     Host controller (authoritative game loop, bots, timer) + host UI + synth audio
src/phone/    Thin phone controller UI
tests/        Vitest unit tests for the engine
```

- **Host-authoritative.** Phones send `action` messages `{ token, msg }`. The host
  validates them by running the pure `reduce(game, action)`, then broadcasts
  `state` with the public game plus per-player private state (Log Review peeks)
  keyed by a hash of each seat token. Raw tokens are never rebroadcast.
- **Pure & seeded.** `reduce` never mutates its input and takes all randomness
  from a mulberry32 RNG stored in the state, so a seed + action log replays a
  game exactly.
- **Reconnects.** Each phone keeps a random seat token in `localStorage` per room
  code. After a refresh or sleep it reconnects to the same seat automatically.
  Phones send a heartbeat every 4 s; the host greys out players it hasn't heard
  from in 15 s.
- **Room codes** are 4 letters without I or O. The host keeps its game in
  `sessionStorage`, so refreshing the host keeps the room; closing the tab kills it
  (phones are told the room closed).
- **Late joiners** become spectators.
- **Audio** is synthesized with Web Audio (keyboard clacks, fan whine that rises
  as Bugs approach the limit, pager + explosion, cha-ching), so there are no
  sound files to license. Phones vibrate on Bug draws and PROD DOWN.

Party-game security: anyone who can subscribe to a room's channel can read the
broadcast traffic, which is fine for a conference room but not for anything you
need to keep secret.

## Rules clarifications

Where the design brief was open to interpretation, this is what the engine does:

- **Rollback:** one charge. Using it spends it until you recharge it (3 ☕) in the Vendor Portal, so at most one per round.
- **Budget** is earned fresh each round and lost if unspent, except after the last round, where it converts to UP.
- **Kudos Die:** ties for furthest all roll.
- **Change Freeze:** drawing your 2nd Bug worth 3 auto-ships you, even if that Bug would have taken prod down.
- **Shadow IT** with 2 players: your left and right neighbor are the same person.
- **Process improvement** costs 2 ☕ per space (max start space 12).
