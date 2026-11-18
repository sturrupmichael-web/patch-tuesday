# BRIMSTONE & BREW 🧪💥

A Jackbox-style party game about brewing potions at a night fair. One laptop on
the big screen is the **host**; 2–6 players join on their **phones**.

Every ingredient you stir into your cauldron moves you further along the Brew
Track, where the rewards get bigger. But your satchel is full of volatile
Brimstone, and if your Brimstone adds up to more than 7, your cauldron goes
**KABOOM**. Brew as far as you dare, then **CORK IT**. Nine nights later, the
brewer with the most Renown is crowned Grand Alchemist of the Fair.

All names, art and theme are original to this game. (The repo, URL and some
internal identifiers still say `patch-tuesday`, from the game's first, IT-themed version.)

## How to play (60-second version)

1. **The Omen:** each night opens with a parchment scroll that bends the rules (Bubbling Start, Haggling Day, Calm Winds…).
2. **Underdog's Luck:** brewers behind the leader in Renown get a head start.
3. **Brewing (everyone at once):** tap STIR IN to draw a random ingredient from your satchel. Tap CORK IT to stop. More than 7 Brimstone = KABOOM. Your **Ladle** can scoop out a Brimstone you just added (restoring it costs 3 💎).
4. **Judging:** the furthest brewer who didn't explode rolls the Lucky Die. Ingredient effects score. Still standing = take the Silver **and** the Renown for your space. Exploded = sell the scraps (Silver) **or** tell the tale (Renown), not both.
5. **Herb Market:** spend Silver on up to 2 ingredients of different kinds. Unspent Silver is lost (use it or lose it). Spend Moonstones to restore your Ladle (3 💎) or **stoke the fire** (2 💎: start 1 space further, forever).

After night 9, leftover 5 Silver → 1 Renown and 2 💎 → 1 Renown.

| Ingredient | Values | Effect |
| --- | --- | --- |
| ☄️ Brimstone | 1/2/3 | Danger. More than 7 = KABOOM |
| 🍃 Dewleaf | 1/2/4 | +1 💎 if it's your last or second-to-last ingredient |
| 🥕 Carrot | 1 | Cheap, no effect |
| 🪶 Owl Feather | 1/2/4 | Peek at that many ingredients; add one or none |
| 🧂 Salt Crystal | 1/2/4 | If the previous ingredient was Brimstone, toss it back in the satchel |
| 🌶️ Ember Pepper | 1/2/4 | +1 space per Carrot already in the cauldron (max +2). Sold from night 2 |
| 🫐 Shadow Plum | 1 | More than one neighbor = +1 space; more than both = +1 space +1 💎. Sold from night 2 |
| 🌸 Starbloom | 1 | 1/2/3+ in the cauldron = +1 ★ / +1 ★ +1 💎 / +2 ★ + a free Carrot. Sold from night 3 |

All numbers (prices, the Brew Track, Omens, Lucky Die faces) and all theme words live in
[`src/engine/data.ts`](src/engine/data.ts) for easy rebalancing. The engine keeps its
original internal identifiers (`bug`, `ship`, `coffee`…); the glossary at the top of
that file maps them to the brewing words players see.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173/patch-tuesday/host/  and  /patch-tuesday/
npm test           # rules-engine unit tests (vitest)
npm run e2e        # full 9-round browser smoke test (needs `npm run dev` running and `npx playwright` available)
                   # with Supabase env vars set, run it as `SEPARATE_PHONES=1 npm run e2e`
npm run build      # type-check + static build into dist/
```

Without Supabase env vars the game runs in **local mode**: it talks over the
browser's `BroadcastChannel`, so the host and the "phones" must be tabs of the
same browser. Each tab gets its own seat. That's the quickest way to hack on it.

**Solo testing / dev mode:** open the host with `?dev`
(`/patch-tuesday/host/?dev`). The lobby gets an **Add dev bot** button, so you
can fill the table with bots and play one phone tab against them. Add
`&seed=1234` to replay the exact same satchel draws and Omens.

To test with real phones on your Wi-Fi, set up Supabase (below) and open
`http://<your-laptop-ip>:5173/patch-tuesday/host/`; the QR code points phones at
that address.

## Supabase setup (realtime)

No database tables are needed; the game only uses Realtime **broadcast**.

1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine).
2. In **Project Settings → API**, copy the project URL and the **anon / publishable** key.
3. Put them in `.env` (committed, used by the deploy) or `.env.local` (local override):

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

The site deploys itself, the same way League Night does. `sturrupmichael-web.github.io`
uses the `michaelsturrup.com` domain, so this repo's GitHub Pages site is served at
**https://michaelsturrup.com/patch-tuesday/** (phone join screen) and
**https://michaelsturrup.com/patch-tuesday/host/** (host screen).

- One-time setup: in this repo, **Settings → Pages → Source: GitHub Actions**.
- Every push to `main` runs **Tests**; when they pass, **Deploy** (`.github/workflows/deploy.yml`)
  builds that commit and publishes `dist/` to Pages. You can also run Deploy by hand from the Actions tab.
- The build reads the Supabase URL and publishable key from the committed `.env`
  (they are public by design). `.env.local` overrides them locally and is git-ignored.
- The game is **unlisted**: it isn't in the site's `games.json`, and both pages carry
  `<meta name="robots" content="noindex">`. To launch it, add an entry to `games.json` in
  `sturrupmichael-web.github.io` and remove the noindex tags.

To host it somewhere else instead, run `npm run build` (set `VITE_BASE` if the path
isn't `/patch-tuesday/`) and upload `dist/`.

## Architecture

```
src/engine/   Pure rules engine: data.ts (balance), engine.ts (reduce), bot.ts, rng.ts
src/net/      Wire protocol + transport (Supabase Realtime, or BroadcastChannel locally)
src/host/     Host controller (authoritative game loop, bots, timer) + host UI + synth audio
src/phone/    Thin phone controller UI
tests/        Vitest unit tests for the engine
docs/         PLAYTEST.md: the real-phone checklist
```

- **Host-authoritative.** Phones send `action` messages `{ token, msg }`. The host
  validates them by running the pure `reduce(game, action)`, then broadcasts
  `state` with the public game plus per-player private state (Owl Feather peeks)
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
- **Audio** is synthesized with Web Audio (bubble plops, a simmer that rises
  as Brimstone nears the limit, a fizzing fuse + explosion, coin clinks), so there are no
  sound files to license. Phones vibrate on Brimstone draws and KABOOM.

Party-game security: anyone who can subscribe to a room's channel can read the
broadcast traffic, which is fine for a conference room but not for anything you
need to keep secret.

## Rules clarifications

Where the design brief was open to interpretation, this is what the engine does:

- **Ladle:** one use. Using it spends it until you restore it (3 💎) at the Herb Market, so at most one per night.
- **Silver** is earned fresh each night and lost if unspent, except after the last night, where it converts to Renown.
- **Lucky Die:** ties for furthest all roll.
- **Calm Winds:** drawing your 2nd Brimstone worth 3 corks you, even if that Brimstone would have blown your cauldron.
- **Shadow Plum** with 2 players: your left and right neighbor are the same person.
- **Stoke the fire** costs 2 💎 per space (max start space 12).
- **Rival Peddler** (bot, 2–3 players): corks once it has 5+ Brimstone or after 12 draws, and buys randomly from what it can afford.
