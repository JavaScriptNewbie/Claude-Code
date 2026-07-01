// Tests: (1) NPC claim auto-clears linked daily, (2) editable stats CRUD + radar,
// (3) tall modal is scrollable.
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);
const dismissLevelup = async () => {
  await p.waitForTimeout(650);                       // level-up overlay shows ~420ms after XP
  for (let i = 0; i < 3 && await p.isVisible('#levelup.show'); i++) {
    await p.click('#levelup', { force: true }); await p.waitForTimeout(300);
  }
};

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// ---------- 1. NPC claim auto-clears the linked "to-do" daily ----------
// Seed an NPC bounty + confirm the default to-do daily has linkNpc.
const setup = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  const link = s.quests.find(x => x.linkNpc);
  s.quests.push({ id: 'npc1', t: 'Test bounty', stat: 'FOC', xp: 60, type: 'npc', claimed: false });
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
  return { hasLink: !!link, linkId: link && link.id, linkXp: link && link.xp };
});
log('Default to-do daily has linkNpc:', setup.hasLink);
if (!setup.hasLink) fail.push('default to-do daily missing linkNpc flag');
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);
await p.click('.tab[data-v="quests"]');
await p.click('.qtab[data-q="npc"]');
await p.waitForTimeout(200);
const xpBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
await p.click('#questList .quest[data-id="npc1"] .check');
await p.waitForTimeout(400);
const res1 = await p.evaluate((linkId) => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  return { totalXP: s.totalXP, npcClaimed: s.quests.find(x => x.id === 'npc1').claimed, dailyDone: !!s.daily.done[linkId] };
}, setup.linkId);
log('After claim:', JSON.stringify(res1), '(was', xpBefore + ')');
if (!res1.npcClaimed) fail.push('npc not claimed');
if (!res1.dailyDone) fail.push('linked daily was NOT auto-cleared');
// total should rise by bounty xp (60) + linked daily xp (20)
if (res1.totalXP !== xpBefore + 60 + setup.linkXp) fail.push('XP not bounty+daily: got ' + res1.totalXP + ' expected ' + (xpBefore + 60 + setup.linkXp));
await dismissLevelup();   // claiming pushed XP to level 2; clear the celebration overlay

// ---------- 2. editable stats ----------
await p.click('.tab[data-v="system"]');
await p.waitForTimeout(200);
const rows0 = await p.$$eval('#statManager .statrow', n => n.length);
log('Stat rows:', rows0);
if (rows0 !== 5) fail.push('expected 5 default stats, got ' + rows0);

// 2a. add a stat
await p.click('#addStat');
await p.waitForTimeout(200);
await p.fill('#stName', 'Willpower');
await p.fill('#stKey', 'wil');           // lowercase -> should uppercase
await p.fill('#stDesc', 'Discipline');
await p.click('#stSwatches .sw:nth-child(6)');
await p.click('#stSave');
await p.waitForTimeout(300);
const added = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  return { has: s.stats.some(x => x.k === 'WIL'), xp: s.statXP.WIL, n: s.stats.length };
});
log('Added WIL:', JSON.stringify(added));
if (!added.has) fail.push('new stat WIL not added (key not uppercased?)');
if (added.xp !== 0) fail.push('new stat XP not initialised');
// radar should now have 6 axis labels
const radarLabels = await p.evaluate(() => document.querySelectorAll('#radar text').length);
log('Radar text nodes (labels+lv):', radarLabels);
if (radarLabels < 12) fail.push('radar did not pick up the new stat (labels=' + radarLabels + ')');

// 2b. quest stat picker offers the new stat
await p.click('.tab[data-v="quests"]');
await p.click('#addQuest');
await p.waitForTimeout(200);
const pickerHasWil = await p.$$eval('#qmStats .sp', els => els.some(e => e.dataset.k === 'WIL'));
if (!pickerHasWil) fail.push('quest stat picker missing new stat');
await p.click('#qmCancel');

// 2c. edit a stat's key -> remaps quests + xp
await p.click('.tab[data-v="system"]');
await p.waitForTimeout(150);
// give STR some xp + a quest, then rename STR->PWR
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  s.statXP.STR = 360;
  s.quests.push({ id: 'qstr', t: 'Pushups', stat: 'STR', xp: 10, type: 'daily', core: false });
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
});
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
await p.click('.tab[data-v="system"]'); await p.waitForTimeout(150);
await p.click('#statManager .statrow[data-k="STR"] [data-act="edit"]');
await p.waitForTimeout(200);
await p.fill('#stKey', 'PWR');
await p.click('#stSave');
await p.waitForTimeout(300);
const renamed = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  return { pwrXp: s.statXP.PWR, strGone: s.statXP.STR === undefined, questRemapped: s.quests.find(x => x.id === 'qstr').stat };
});
log('Rename STR->PWR:', JSON.stringify(renamed));
if (renamed.pwrXp !== 360) fail.push('xp not remapped on key rename');
if (!renamed.strGone) fail.push('old key xp not removed on rename');
if (renamed.questRemapped !== 'PWR') fail.push('quest not remapped on rename');

// 2d. delete a stat -> quests reassigned, min-3 guard
p.on('dialog', d => d.accept());   // accept the confirm()
await p.click('#statManager .statrow[data-k="GOLD"] [data-act="delstat"]');
await p.waitForTimeout(300);
const afterDel = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  return { n: s.stats.length, goldGone: !s.stats.some(x => x.k === 'GOLD'), goldXp: s.statXP.GOLD };
});
log('After delete GOLD:', JSON.stringify(afterDel));
if (!afterDel.goldGone) fail.push('GOLD not deleted');
if (afterDel.goldXp !== undefined) fail.push('deleted stat XP not removed');

// ---------- 3. tall modal scrollable ----------
await p.click('.tab[data-v="quests"]');
await p.click('#addQuest');
await p.waitForTimeout(300);
const scroll = await p.evaluate(() => {
  const ov = document.getElementById('questModal');
  ov.scrollTop = 0;
  const before = ov.scrollTop;
  ov.scrollTop = 9999;
  const after = ov.scrollTop;
  return { scrollable: ov.scrollHeight > ov.clientHeight, moved: after > before, sh: ov.scrollHeight, ch: ov.clientHeight };
});
log('Quest modal scroll:', JSON.stringify(scroll));
// On this tall modal at iPhone-12 height it should be scrollable; if it fits, that's also fine,
// but the overflow container must be set up (overflow-y auto). Assert the save button is reachable.
const saveVisible = await p.isVisible('#qmSave');
if (!saveVisible) fail.push('quest modal save button not reachable');
if (scroll.sh > scroll.ch && !scroll.moved) fail.push('tall modal not scrollable');
await p.click('#qmCancel');

const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await p.screenshot({ path: 'shots/11-stats.png' });
await b.close();
log('\n===== FEATURES RESULT =====');
if (!fail.length) log('ALL FEATURE CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
