// Tests the day navigator: pick/step to a past day and the whole Quests screen
// becomes that day. Completing a daily logs it against that date (not today),
// missed NPC bounties and events can be claimed/attended for the chosen day, and a
// fully-core-cleared past day in the current ISO week still hits the weekly boss.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

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
const yStr = ymd(yesterday), todayStr = ymd(now);
const ySameWeek = isoWeekId(yesterday) === isoWeekId(now);

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const p = await ctx.newPage();
const ls = () => p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')));
const dismiss = async () => { await p.waitForTimeout(650); for (let i = 0; i < 3 && await p.isVisible('#levelup.show'); i++) { await p.click('#levelup', { force: true }); await p.waitForTimeout(250); } };
const isDone = (id) => p.evaluate(i => { const n = document.querySelector('.quest[data-id="' + i + '"]'); return !!n && n.classList.contains('done'); }, id);
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

if ((await ls()).version !== 6) fail.push('schema not 6');

await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(200);

// ---------- 1. nav defaults to today; can't go forward ----------
if (!(await p.isVisible('#dayNav'))) fail.push('day navigator missing');
if ((await p.textContent('#dayLabel')) !== 'TODAY') fail.push('nav did not start on TODAY');
if (!(await p.isDisabled('#dayNext'))) fail.push('next-day arrow not disabled on today');
if (await p.isVisible('#dayToday')) fail.push('TODAY button shown while already on today');

// ---------- 2. step back a day → screen becomes yesterday ----------
await p.click('#dayPrev'); await p.waitForTimeout(200);
log('label after prev:', await p.textContent('#dayLabel'));
if ((await p.textContent('#dayLabel')) !== 'YESTERDAY') fail.push('prev did not move to yesterday');
if (!(await p.evaluate(() => document.getElementById('dayNav').classList.contains('past')))) fail.push('nav missing .past styling');
if (!(await p.isVisible('#dayToday'))) fail.push('TODAY return button not shown on a past day');
if (!(await p.evaluate(() => document.getElementById('questList').classList.contains('pastday')))) fail.push('quest list not flagged pastday');
if (await p.isVisible('#timerRow')) fail.push('reset countdown should hide on a past day');

const dailies = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests
  .filter(x => x.type !== 'npc' && x.type !== 'event').map(x => ({ id: x.id, xp: x.xp, core: !!x.core })));
const bonus = dailies.filter(x => !x.core);

// ---------- 3. completing a daily logs it to YESTERDAY, not today ----------
const pre = await ls();
const bId = bonus[0].id, bXp = bonus[0].xp;
await p.click('.quest[data-id="' + bId + '"] .check'); await dismiss();
let post = await ls();
log('XP', pre.totalXP, '->', post.totalXP, '(+' + bXp + ')');
if (post.totalXP !== pre.totalXP + bXp) fail.push('backfilled daily did not add XP');
if (!post.dailyLog[yStr] || !post.dailyLog[yStr][bId]) fail.push('completion not logged to yesterday');
if (post.daily.done[bId]) fail.push('past-day completion leaked into today\'s board');
if (post.streak.cur !== pre.streak.cur) fail.push('streak moved on a backfill (should not)');

// ---------- 4. same day can't double-count; un-tick refunds ----------
await p.click('.quest[data-id="' + bId + '"] .check'); await p.waitForTimeout(300);
post = await ls();
if (post.totalXP !== pre.totalXP) fail.push('un-ticking a past daily did not refund');
if (post.dailyLog[yStr] && post.dailyLog[yStr][bId]) fail.push('un-ticked daily still in the log');
// re-tick it for later checks
await p.click('.quest[data-id="' + bId + '"] .check'); await dismiss();

// ---------- 5. returning to TODAY shows that daily as NOT done (independent days) ----------
await p.click('#dayToday'); await p.waitForTimeout(250);
if ((await p.textContent('#dayLabel')) !== 'TODAY') fail.push('TODAY button did not return to today');
if (await isDone(bId)) fail.push('daily logged yesterday wrongly shows done today');
// completing it today is a separate, legit log
const beforeToday = (await ls()).totalXP;
await p.click('.quest[data-id="' + bId + '"] .check'); await dismiss();
post = await ls();
if (!post.daily.done[bId]) fail.push('completing the daily today did not record on today\'s board');
if (post.dailyLog[yStr] && !post.dailyLog[yStr][bId]) fail.push('today\'s completion clobbered yesterday\'s log');
if (post.totalXP !== beforeToday + bXp) fail.push('today completion XP wrong');
await p.click('.quest[data-id="' + bId + '"] .check'); await p.waitForTimeout(250); // undo, keep today clean

// ---------- 6. complete a MISSED NPC bounty for a past day ----------
await p.click('#dayPrev'); await p.waitForTimeout(200);
await p.click('.qtab[data-q="npc"]'); await p.waitForTimeout(200);
if (!(await p.isVisible('#dayNav'))) fail.push('day nav should persist on the NPC tab');
const npc = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.find(x => x.type === 'npc' && !x.claimed));
const npcXpBefore = (await ls()).totalXP;
await p.click('.quest[data-id="' + npc.id + '"] .check'); await dismiss();
let after = await ls();
const npcNow = after.quests.find(x => x.id === npc.id);
log('npc claimedDate:', npcNow.claimedDate);
if (!npcNow.claimed) fail.push('missed NPC not claimed');
if (npcNow.claimedDate !== yStr) fail.push('NPC claim not stamped with the viewed day: ' + npcNow.claimedDate);
if (after.totalXP !== npcXpBefore + npc.xp) fail.push('claiming missed NPC did not add its XP');

// ---------- 7. attend a MISSED event for a past day ----------
await p.click('.qtab[data-q="event"]'); await p.waitForTimeout(200);
const ev = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.find(x => x.type === 'event' && !x.attended));
await p.click('.quest[data-id="' + ev.id + '"] .check'); await dismiss();
after = await ls();
const evNow = after.quests.find(x => x.id === ev.id);
if (!evNow.attended) fail.push('missed event not marked attended');
if (evNow.attendedDate !== yStr) fail.push('event attendance not stamped with the viewed day: ' + evNow.attendedDate);

// ---------- 8. clearing all cores for yesterday hits the weekly boss (this week only) ----------
await p.click('.qtab[data-q="daily"]'); await p.waitForTimeout(200);
const cores = dailies.filter(x => x.core);
const bossPre = (await ls()).boss.days, streakPre = (await ls()).streak.cur;
for (const c of cores) { if (!(await isDone(c.id))) { await p.click('.quest[data-id="' + c.id + '"] .check'); await dismiss(); } }
let bossState = await ls();
log('boss.days', bossPre, '->', bossState.boss.days, '| yesterday same week:', ySameWeek);
if (ySameWeek) {
  if (bossState.boss.days !== bossPre + 1) fail.push('boss not hit by backfilled core day: +' + (bossState.boss.days - bossPre));
  if (!(bossState.boss.backDates || []).includes(yStr)) fail.push('boss.backDates missing yesterday');
} else if (bossState.boss.days !== bossPre) fail.push('boss credited outside current week');
if (bossState.streak.cur !== streakPre) fail.push('streak changed from backfilling cores (should not)');

// ---------- 9. persistence + viewDate resets to today on reload ----------
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(200);
if ((await p.textContent('#dayLabel')) !== 'TODAY') fail.push('reload did not reset the view to today');
const persisted = await ls();
if (!persisted.dailyLog[yStr] || !persisted.dailyLog[yStr][bId]) fail.push('yesterday log did not persist across reload');

await p.screenshot({ path: 'shots/14-dayview.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== DAY-VIEW RESULT =====');
if (!fail.length) log('ALL DAY-VIEW CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
