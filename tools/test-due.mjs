import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);

// Seed: clear state, add one NPC bounty already past due, one due in the future.
await p.evaluate(() => {
  localStorage.removeItem('system_rpg_v1');
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// 1. Add an NPC bounty with a FUTURE due date via the UI
await p.click('.tab[data-v="quests"]');
await p.click('.qtab[data-q="npc"]');
await p.waitForTimeout(200);
await p.click('#addQuest');
await p.waitForTimeout(200);
const dueRowVisible = await p.isVisible('#qmDue');
log('Due field visible for NPC:', dueRowVisible);
if (!dueRowVisible) fail.push('due field not shown for NPC type');
await p.fill('#qmName', 'Future Assignment');
await p.fill('#qmDue', '2999-01-01T09:00');
await p.fill('#qmXp', '50');
await p.click('#qmSave');
await p.waitForTimeout(300);
const hasFuture = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.some(q => q.t === 'Future Assignment' && q.due));
log('Future bounty saved with due:', hasFuture);
if (!hasFuture) fail.push('future due date not saved');

// 2. Daily type should NOT show due field
await p.click('#addQuest');
await p.waitForTimeout(150);
await p.click('#qmType .segopt[data-t="daily"]');
await p.waitForTimeout(150);
const dueHiddenForDaily = !(await p.isVisible('#qmDue'));
log('Due field hidden for daily:', dueHiddenForDaily);
if (!dueHiddenForDaily) fail.push('due field should be hidden for daily quests');
await p.click('#qmCancel');

// 3. Inject a PAST-due bounty + known XP, then verify penalty fires
const xpBefore = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  s.totalXP = 1000; s.statXP.FOC = 500;
  s.quests.push({ id: 'overdue1', t: 'Late Essay', stat: 'FOC', xp: 80, type: 'npc', claimed: false, due: '2000-01-01T09:00' });
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
  return s.totalXP;
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(500);
const after = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  const q = s.quests.find(x => x.id === 'overdue1');
  return { totalXP: s.totalXP, foc: s.statXP.FOC, expired: q && q.expired, failXp: q && q.failXp };
});
log('After overdue check:', JSON.stringify(after), '(was', xpBefore + ')');
if (after.totalXP !== xpBefore - 80) fail.push('penalty XP wrong: ' + after.totalXP);
if (after.foc !== 500 - 80) fail.push('penalty stat XP wrong: ' + after.foc);
if (!after.expired) fail.push('overdue quest not marked expired');

// 4. Expired quest shows in archived section, styled .expired, and cannot be claimed
await p.click('.tab[data-v="quests"]');
await p.click('.qtab[data-q="npc"]');
await p.waitForTimeout(300);
const expiredShown = await p.$$eval('#questList .quest.expired', n => n.length);
log('Expired cards shown:', expiredShown);
if (expiredShown < 1) fail.push('expired quest not rendered with .expired');
// try to claim it -> should be blocked (XP unchanged)
await p.click('#questList .quest.expired .check');
await p.waitForTimeout(300);
const afterClaimAttempt = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
if (afterClaimAttempt !== after.totalXP) fail.push('expired quest was claimable (XP changed)');

// 5. Idempotent: reload again, no double penalty
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const twice = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
log('After 2nd reload (should be unchanged):', twice);
if (twice !== after.totalXP) fail.push('penalty applied twice (not idempotent): ' + twice);

await p.screenshot({ path: 'shots/07-duedates.png' });

// the only external resource is the Google Fonts CDN (blocked in this sandbox)
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== DUE-DATE RESULT =====');
if (!fail.length) log('ALL DUE-DATE CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
