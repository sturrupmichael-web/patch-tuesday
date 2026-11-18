# Real-phone playtest (about 10 minutes)

Everything automated so far ran simulated phones in a browser. This checklist covers what only
real phones on real Wi-Fi can show. You need a laptop for the host screen and 3–4 phones
(ideally a mix of iPhone and Android).

## Setup
1. On the laptop, open **https://michaelsturrup.com/patch-tuesday/host/** and make it fullscreen (⛶).
2. Click anywhere once so the browser allows sound.
3. In the lobby, pick **Quick fair (6 nights)** and a **60s** timer.

## Checklist
Tick each one, and note anything odd (phone model + what happened).

**Joining**
- [ ] Scanning the QR code opens the join screen with the room code already filled in.
- [ ] Typing the code by hand also works.
- [ ] Every player appears in the lobby within a couple of seconds, with the right name and brewer.

**Brewing**
- [ ] STIR IN responds immediately, and the ingredient lands in the right cauldron on the big screen.
- [ ] Tapping STIR IN twice very fast adds only **one** ingredient.
- [ ] The "% chance to blow" line goes up as Brimstone builds.
- [ ] Phones vibrate on Brimstone and on KABOOM (Android; iPhones don't support web vibration).
- [ ] The big screen shows KABOOM / CORKED IT banners, with sound.
- [ ] The Ladle button appears after a Brimstone and removes it.
- [ ] The timer auto-corks anyone still brewing when it runs out.

**Reconnects**
- [ ] Lock one phone for 30 seconds mid-night, then unlock it. It comes back to the same seat.
- [ ] Refresh one phone's browser. Same seat, no re-join needed.
- [ ] Close the laptop lid for 20 seconds during brewing, then open it. Phones show
      "Waiting for the host…", then carry on, and nobody was auto-corked by the timer.

**Scoring and shopping**
- [ ] An exploded player gets the "sell the scraps / tell the tale" choice and the game waits for it.
- [ ] The Herb Market only lets you buy what you can afford (2 different ingredients max).
- [ ] The final screen shows the Grand Alchemist podium and awards.

## After
Tell Claude in the project thread which boxes failed, and anything that felt confusing, slow
or fiddly. Phone model and browser help a lot.
