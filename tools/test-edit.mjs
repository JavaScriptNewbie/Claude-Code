// Tests: NPC un-claim reverses the linked daily (day-scoped, multi-bounty), and
// editing an existing quest updates it in place with the type locked.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const p = await ctx.newPage();
const dismiss = async () => { await p.waitForTimeout(650); for (let i = 0; i < 3 && await p.isVisible('#levelup.show'); i++) { await p.click('#levelup', { force: true }); await p.waitForTimeout(250); } };
const ls = () => p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')));
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

const link = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  const d = s.quests.find(x => x.linkNpc);
  s.quests.push({ id: 'A', t: 'Bounty A', stat: 'FOC', xp: 50, type: 'npc', claimed: false });
  s.quests.push({ id: 'B', t: 'Bounty B', stat: 'FOC', xp: 50, type: 'npc', claimed: false });
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
  return { id: d.id, xp: d.xp };
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.click('.tab[data-v="quests"]');
await p.click('.qtab[data-q="npc"]');
await p.waitForTimeout(200);
const base = (await ls()).totalXP;

// claim A -> daily cleared, +50 +20
await p.click('#questList .quest[data-id="A"] .check');
await dismiss();
let s = await ls();
log('after claim A:', s.totalXP, 'dailyDone=', !!s.daily.done[link.id]);
if (!s.daily.done[link.id]) fail.push('claim A did not clear linked daily');
if (s.totalXP !== base + 50 + link.xp) fail.push('claim A xp wrong: ' + s.totalXP);

// claim B -> daily already cleared, only +50 (no extra daily)
await p.click('#questList .quest[data-id="B"] .check');
await dismiss();
s = await ls();
log('after claim B:', s.totalXP);
if (s.totalXP !== base + 50 + link.xp + 50) fail.push('claim B should add only its own xp: ' + s.totalXP);

// un-claim B -> daily stays (A still claimed today), -50
await p.click('#questList .quest[data-id="B"] .check');
await p.waitForTimeout(300);
s = await ls();
log('after unclaim B:', s.totalXP, 'dailyDone=', !!s.daily.done[link.id]);
if (!s.daily.done[link.id]) fail.push('unclaim B wrongly reopened daily (A still claimed)');
if (s.totalXP !== base + 50 + link.xp) fail.push('unclaim B xp wrong: ' + s.totalXP);

// un-claim A -> now no bounty claimed today -> daily reopens, refund daily too -> back to base
await p.click('#questList .quest[data-id="A"] .check');
await p.waitForTimeout(300);
s = await ls();
log('after unclaim A:', s.totalXP, 'dailyDone=', !!s.daily.done[link.id]);
if (s.daily.done[link.id]) fail.push('unclaim A did not reopen the linked daily');
if (s.totalXP !== base) fail.push('unclaim A did not return to baseline: ' + s.totalXP);

// manual completion must NOT be undone by bounty unclaim
await p.click('#questList .quest[data-id="A"] .check'); await dismiss();     // claim A (clears daily via link)
// manually toggle the daily OFF then ON so it's now manually-owned
await p.click('.qtab[data-q="daily"]'); await p.waitForTimeout(150);
await p.click('#questList .quest[data-id="' + link.id + '"] .check'); await p.waitForTimeout(200); // uncheck (drops link flag)
await p.click('#questList .quest[data-id="' + link.id + '"] .check'); await dismiss();            // recheck manually
await p.click('.qtab[data-q="npc"]'); await p.waitForTimeout(150);
await p.click('#questList .quest[data-id="A"] .check'); await p.waitForTimeout(300);  // unclaim A
s = await ls();
log('manual-daily survives unclaim:', !!s.daily.done[link.id]);
if (!s.daily.done[link.id]) fail.push('manually-completed daily was wrongly reopened by bounty unclaim');

// -------- EDIT existing quest --------
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
await p.click('.tab[data-v="quests"]');
await p.click('#addQuest'); await p.waitForTimeout(200);
await p.fill('#qmName', 'Edit Me'); await p.fill('#qmXp', '15'); await p.click('#qmSave');
await p.waitForTimeout(300);
const qid = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.find(x => x.t === 'Edit Me').id);
// open editor via the pencil
await p.click('#questList .quest[data-id="' + qid + '"] [data-act="edit"]');
await p.waitForTimeout(250);
const titleTxt = await p.textContent('#qmTitle');
const typeLocked = await p.evaluate(() => getComputedStyle(document.getElementById('qmType')).pointerEvents);
log('editor title:', titleTxt, '| type pointer-events:', typeLocked);
if (!/EDIT/.test(titleTxt)) fail.push('editor title not EDIT');
if (typeLocked !== 'none') fail.push('type not locked during edit');
// prefilled name + xp
const nameVal = await p.inputValue('#qmName'), xpVal = await p.inputValue('#qmXp');
if (nameVal !== 'Edit Me' || xpVal !== '15') fail.push('editor not prefilled: ' + nameVal + '/' + xpVal);
// change name + xp + stat + enable link, save
await p.fill('#qmName', 'Edited Title'); await p.fill('#qmXp', '88');
await p.click('#qmStats .sp[data-k="STR"]');
await p.click('#qmLink');
await p.click('#qmSave'); await p.waitForTimeout(300);
const edited = await p.evaluate((id) => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.find(x => x.id === id), qid);
log('edited:', JSON.stringify({ t: edited.t, xp: edited.xp, stat: edited.stat, link: edited.linkNpc }));
if (edited.t !== 'Edited Title' || edited.xp !== 88 || edited.stat !== 'STR' || !edited.linkNpc) fail.push('edit did not persist: ' + JSON.stringify(edited));
// id preserved + still a single quest (not duplicated)
const count = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.filter(x => /Edit/.test(x.t)).length);
if (count !== 1) fail.push('edit duplicated the quest (' + count + ')');

await p.screenshot({ path: 'shots/12-edit.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== EDIT/UNLINK RESULT =====');
if (!fail.length) log('ALL EDIT/UNLINK CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
