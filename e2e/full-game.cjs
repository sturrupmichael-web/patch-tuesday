// End-to-end smoke test: a host tab, two phone tabs and a dev bot play all 9 rounds
// in local (BroadcastChannel) mode. Start `npm run dev` first, then `npm run e2e`.
const { chromium } = require('playwright');
const SHOTS = (process.env.SHOTS_DIR ?? 'e2e/shots') + '/';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/patch-tuesday';
require('fs').mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];
  const host = await ctx.newPage();
  await host.setViewportSize({ width: 1920, height: 1080 });
  host.on('pageerror', (e) => errors.push('host: ' + e.message));
  host.on('console', (m) => m.type() === 'error' && errors.push('host console: ' + m.text()));
  await host.goto(BASE + '/host/?dev');
  await host.waitForSelector('.code');
  const code = (await host.textContent('.code')).trim();
  console.log('room', code);
  const phones = [];
  for (const [name, av] of [['Dana', 'goblin'], ['Mike', 'intern']]) {
    // In Supabase mode each phone needs its own browser profile (own localStorage seat token).
    const p = process.env.SEPARATE_PHONES ? await (await browser.newContext()).newPage() : await ctx.newPage();
    await p.setViewportSize({ width: 390, height: 844 });
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/?code=' + code);
    await p.fill('input[name=name]', name);
    await p.click(`[data-id=${av}]`);
    await p.click('button[type=submit]');
    phones.push(p);
  }
  await phones[1].waitForSelector('text=on the roster');
  await phones[0].screenshot({ path: SHOTS + 'phone-lobby.png' });
  await host.click('[data-act=add-bot]');
  await host.waitForTimeout(500);
  await host.screenshot({ path: SHOTS + 'host-lobby.png' });
  await host.click('[data-act=start]');
  await host.waitForSelector('.memo');
  await host.waitForTimeout(1500);
  await host.screenshot({ path: SHOTS + 'host-cab.png' });
  await phones[0].screenshot({ path: SHOTS + 'phone-cab.png' });
  await host.click('.memo-go');
  for (let round = 1; round <= 9; round++) {
    await phones[0].waitForSelector('.deploy-btn, .peek-btn', { timeout: 15000 });
    for (let step = 0; step < 60; step++) {
      let any = false;
      for (const [i, p] of phones.entries()) {
        if (await p.$('.peek-btn')) {
          await p.click('[data-act=peek] >> nth=0');
          any = true;
          await p.waitForTimeout(200);
          continue;
        }
        const btn = await p.$('.deploy-btn');
        if (!btn) continue;
        any = true;
        const txt = await p.textContent('.pgauge .lbl');
        const bugs = Number(/BUGS (\d+)/.exec(txt)[1]);
        if (bugs >= (i === 0 ? 5 : 6)) await p.click('[data-act=ship]');
        else await btn.click();
        await p.waitForTimeout(200);
      }
      if (round === 1 && step === 3) {
        await host.screenshot({ path: SHOTS + 'host-deploy.png' });
        await phones[0].screenshot({ path: SHOTS + 'phone-deploy.png' });
      }
      if (!any) break;
    }
    await host.waitForSelector('.phase-review', { timeout: 30000 });
    await host.waitForTimeout(400);
    for (const p of phones) {
      if (await p.$('[data-act=explain]')) {
        await p.screenshot({ path: SHOTS + 'phone-choice.png' });
        await p.click('[data-act=explain]');
      }
    }
    await host.waitForSelector('[data-act=to-vendor]', { timeout: 30000 });
    if (round === 1) {
      await host.waitForTimeout(2500);
      await host.screenshot({ path: SHOTS + 'host-review.png' });
    }
    await host.click('[data-act=to-vendor]');
    if (round === 9) break;
    for (const p of phones) {
      await p.waitForSelector('[data-act=vendor-done]', { timeout: 10000 });
      const buys = await p.$$('[data-act=buy]:not([disabled])');
      if (buys.length) {
        await buys[buys.length - 1].click();
        await p.waitForTimeout(400);
      }
      if (round === 2) await p.screenshot({ path: SHOTS + 'phone-vendor.png', fullPage: true });
      await p.click('[data-act=vendor-done]');
    }
    if (round === 2) await host.screenshot({ path: SHOTS + 'host-vendor.png' });
    await host.waitForSelector('.memo', { timeout: 15000 });
    await host.click('.memo-go');
    console.log('round', round, 'done');
  }
  await host.waitForSelector('.final', { timeout: 10000 });
  await host.waitForTimeout(3000);
  await host.screenshot({ path: SHOTS + 'host-final.png' });
  await phones[0].screenshot({ path: SHOTS + 'phone-final.png' });
  await phones[1].reload();
  await phones[1].waitForSelector('.ptop', { timeout: 10000 });
  console.log('reconnected ok:', await phones[1].textContent('.ptop'));
  console.log('errors', errors);
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
