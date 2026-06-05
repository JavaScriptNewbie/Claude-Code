// Tests the "log a past day" backfill feature: retroactively ticking dailies for a
// past date credits XP to that date's log, refunds on un-tick, and a fully-core-cleared
// day in the current ISO week deals one hit to the weekly boss.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

// mirror of the app's isoWeekId so we can predict boss-week eligibility
function isoWeekId(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - ys) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
}
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const ymd = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
const now = new Date();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
const threeAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
const yStr = ymd(yesterday), tStr = ymd(threeAgo), todayStr = ymd(now);
const ySameWeek = isoWeekId(yesterday) === isoWeekId(now);

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const p = await ctx.newPage();
const ls = () => p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')));
const dismiss = async () => { await p.waitForTimeout(650); for (let i = 0; i < 3 && await p.isVisible('#levelup.show'); i++) { await p.click('#levelup', { force: true }); await p.waitForTimeout(250); } };
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// schema 6
const schema = (await ls()).version;
if (schema !== 6) fail.push('schema not 6 (' + schema + ')');

await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(150);

// backfill button only shows on the daily tab
await p.click('.qtab[data-q="npc"]'); await p.waitForTimeout(150);
if (await p.isVisible('#backfillBtn')) fail.push('backfill button leaked onto NPC tab');
await p.click('.qtab[data-q="daily"]'); await p.waitForTimeout(150);
if (!(await p.isVisible('#backfillBtn'))) fail.push('backfill button missing on daily tab');

// open modal → defaults to yesterday
await p.click('#backfillBtn'); await p.waitForTimeout(200);
if (!(await p.isVisible('#backDate'))) fail.push('backfill modal did not open');
const defDate = await p.inputValue('#backDate');
log('default date:', defDate, '| yesterday:', yStr);
if (defDate !== yStr) fail.push('date did not default to yesterday (' + defDate + ')');

// ---------- 1. XP credited to a past date, refunded on un-tick ----------
const dailies = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests
  .filter(x => x.type !== 'npc' && x.type !== 'event')
  .map(x => ({ id: x.id, t: x.t, xp: x.xp, core: !!x.core, stats: x.stats || [x.stat] })));
const bonus = dailies.filter(x => !x.core).slice(0, 2);

await p.fill('#backDate', tStr); await p.waitForTimeout(200);
const pre = await ls();
const sumXp = bonus[0].xp + bonus[1].xp;
await p.click('.subq[data-back="' + bonus[0].id + '"]'); await dismiss();
await p.click('.subq[data-back="' + bonus[1].id + '"]'); await dismiss();
let post = await ls();
log('XP', pre.totalXP, '->', post.totalXP, '(+' + sumXp + ' expected)');
if (post.totalXP !== pre.totalXP + sumXp) fail.push('backfill XP not credited: +' + (post.totalXP - pre.totalXP));
if (!post.dailyLog[tStr] || !post.dailyLog[tStr][bonus[0].id] || !post.dailyLog[tStr][bonus[1].id]) fail.push('dailyLog did not record the date');
// stat XP rose for the first quest's stats
const s0 = bonus[0].stats[0];
if (post.statXP[s0] !== pre.statXP[s0] + bonus[0].xp) fail.push('stat ' + s0 + ' did not gain backfilled XP');
// the row shows as done
const rowDone = await p.evaluate(id => document.querySelector('.subq[data-back="' + id + '"]').classList.contains('done'), bonus[0].id);
if (!rowDone) fail.push('backfilled row not marked done');

// un-tick one → refund
await p.click('.subq[data-back="' + bonus[1].id + '"]'); await p.waitForTimeout(300);
post = await ls();
if (post.totalXP !== pre.totalXP + bonus[0].xp) fail.push('un-tick did not refund: ' + post.totalXP);
if (post.dailyLog[tStr] && post.dailyLog[tStr][bonus[1].id]) fail.push('un-ticked quest still logged');

// ---------- 2. guard: today is not backfillable ----------
await p.fill('#backDate', todayStr); await p.waitForTimeout(200);
const guard = await p.textContent('#backList');
log('today guard:', JSON.stringify(guard));
if (!/before today/i.test(guard)) fail.push('today not guarded in backfill list');

// ---------- 3. clearing all cores for yesterday hits the weekly boss (current week only) ----------
await p.fill('#backDate', yStr); await p.waitForTimeout(200);
const cores = dailies.filter(x => x.core);
const bossPre = (await ls()).boss.days;
for (const c of cores) { await p.click('.subq[data-back="' + c.id + '"]'); await dismiss(); }
let bossState = await ls();
log('boss.days', bossPre, '->', bossState.boss.days, '| yesterday same ISO week:', ySameWeek);
if (ySameWeek) {
  if (bossState.boss.days !== bossPre + 1) fail.push('boss day not credited for backfilled core day: ' + (bossState.boss.days - bossPre));
  if (!(bossState.boss.backDates || []).includes(yStr)) fail.push('boss.backDates missing the credited date');
  // un-tick one core → boss damage reverts
  await p.click('.subq[data-back="' + cores[0].id + '"]'); await p.waitForTimeout(300);
  bossState = await ls();
  if (bossState.boss.days !== bossPre) fail.push('boss day not reverted after un-clearing a core: ' + bossState.boss.days);
  if ((bossState.boss.backDates || []).includes(yStr)) fail.push('boss.backDates kept a no-longer-cleared date');
} else {
  if (bossState.boss.days !== bossPre) fail.push('boss credited for a day outside the current ISO week');
}

// ---------- 4. log survives reload (persisted) ----------
await p.click('#backDone'); await p.waitForTimeout(150);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
const persisted = await ls();
if (!persisted.dailyLog[tStr] || !persisted.dailyLog[tStr][bonus[0].id]) fail.push('backfill log did not persist across reload');

await p.screenshot({ path: 'shots/14-backfill.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== BACKFILL RESULT =====');
if (!fail.length) log('ALL BACKFILL CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
