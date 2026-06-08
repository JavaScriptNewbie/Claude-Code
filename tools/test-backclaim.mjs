// Tests two fixes:
//  1. Dailies completed on a real day are archived into dailyLog at the daily reset,
//     so stepping back to that day shows them DONE (and they can't be re-logged for XP).
//  2. A bounty whose deadline has passed (expired today) becomes claimable again when
//     you step to a day on or before its due date, and claiming it refunds the
//     missed-deadline penalty as well as paying the reward.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

const pad = (n) => (n < 10 ? '0' + n : '' + n);
const ymd = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
const now = new Date();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
const yStr = ymd(yesterday), todayStr = ymd(now);

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

// ---------- 1. ARCHIVING: a daily done "yesterday" survives the reset ----------
await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(200);
const bonus = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests
  .find(x => x.type !== 'npc' && x.type !== 'event' && !x.core));
const bId = bonus.id, bXp = bonus.xp;

// complete it on today's board, then pretend a day passed (stamp the board as yesterday)
await p.click('.quest[data-id="' + bId + '"] .check'); await dismiss();
const earnedTotal = (await ls()).totalXP;
await p.evaluate((y) => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  s.daily.date = y;                 // the board now belongs to "yesterday"
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
}, yStr);
await p.reload({ waitUntil: 'networkidle' });   // boot → checkDailyReset archives yesterday
await p.waitForTimeout(400);
await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(200);

let s = await ls();
if (!s.dailyLog[yStr] || !s.dailyLog[yStr][bId]) fail.push('reset did not archive yesterday\'s completion into dailyLog');
if (s.daily.done[bId]) fail.push('archived completion leaked into the fresh day');
if (s.totalXP !== earnedTotal) fail.push('archiving changed XP (should not): ' + s.totalXP + ' vs ' + earnedTotal);

// today the daily is open again (fresh board)
if (await isDone(bId)) fail.push('daily wrongly shows done on the new today');

// step back to yesterday → it shows DONE (archived), not empty
await p.click('#dayPrev'); await p.waitForTimeout(250);
if ((await p.textContent('#dayLabel')) !== 'YESTERDAY') fail.push('did not navigate to yesterday');
if (!(await isDone(bId))) fail.push('archived daily appears empty on its own day (the reported bug)');

// re-ticking must NOT add XP again — it should refund (un-tick) instead
const beforeRetick = (await ls()).totalXP;
await p.click('.quest[data-id="' + bId + '"] .check'); await p.waitForTimeout(300);
let after = await ls();
log('re-tick yesterday XP', beforeRetick, '->', after.totalXP, '(expected -' + bXp + ')');
if (after.totalXP !== beforeRetick - bXp) fail.push('re-clicking an archived daily double-counted instead of un-ticking');
if (after.dailyLog[yStr] && after.dailyLog[yStr][bId]) fail.push('un-tick did not remove the archived entry');
// put it back so the day is clean
await p.click('.quest[data-id="' + bId + '"] .check'); await dismiss();
await p.click('#dayToday'); await p.waitForTimeout(200);

// ---------- 2. EXPIRED BOUNTY claimable on an earlier day ----------
// inject an NPC due yesterday 23:59 → boots expired today, penalised once.
await p.evaluate((y) => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  s.quests.push({ id: 'tb-late', t: 'Late bounty', type: 'npc', stat: 'STR', xp: 50, due: y + 'T23:59' });
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
}, yStr);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
await p.click('.tab[data-v="quests"]'); await p.waitForTimeout(150);
await p.click('.qtab[data-q="npc"]'); await p.waitForTimeout(200);

let st = await ls();
let lb = st.quests.find(x => x.id === 'tb-late');
const afterExpiry = st.totalXP;
log('bounty expired on boot:', lb.expired, '| failXp:', lb.failXp, '| total:', afterExpiry);
if (!lb.expired) fail.push('past-due bounty did not expire on boot');
// today it shows expired styling and is blocked
if (!(await p.evaluate(() => { const n = document.querySelector('.quest[data-id="tb-late"]'); return n && n.classList.contains('expired'); }))) fail.push('bounty not styled expired on today');
await p.click('.quest[data-id="tb-late"] .check'); await p.waitForTimeout(250);
if ((await ls()).quests.find(x => x.id === 'tb-late').claimed) fail.push('expired bounty was claimable on today (should be blocked)');

// step back to yesterday (on/before its due date) → claimable again, no expired styling
await p.click('#dayPrev'); await p.waitForTimeout(250);
if (await p.evaluate(() => { const n = document.querySelector('.quest[data-id="tb-late"]'); return n && n.classList.contains('expired'); })) fail.push('bounty still shows expired on a day before its deadline');
if (!(await p.isVisible('.quest[data-id="tb-late"]'))) fail.push('bounty missing from the active list on a valid past day');

await p.click('.quest[data-id="tb-late"] .check'); await dismiss();
st = await ls();
lb = st.quests.find(x => x.id === 'tb-late');
log('after claim on yesterday → claimed:', lb.claimed, 'claimedDate:', lb.claimedDate, 'expired:', lb.expired, 'total:', st.totalXP);
if (!lb.claimed) fail.push('could not claim the bounty on a valid earlier day');
if (lb.claimedDate !== yStr) fail.push('claim not stamped with the viewed day: ' + lb.claimedDate);
if (lb.expired) fail.push('claiming did not clear the expired flag');
if (lb.failXp !== undefined) fail.push('failXp not cleared after refund');
// XP: from expired state (-50) to claimed (+50) → net +100 vs the expired total
if (st.totalXP !== afterExpiry + 100) fail.push('claim did not refund penalty + pay reward (expected +100, got +' + (st.totalXP - afterExpiry) + ')');

await p.screenshot({ path: 'shots/15-backclaim.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== BACK-CLAIM RESULT =====');
if (!fail.length) log('ALL BACK-CLAIM CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
