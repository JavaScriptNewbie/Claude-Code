// Tests v5 features: multi-stat quests (XP to each stat in full, not divided),
// the Events tab (schedule + attend), and arc sub-quests (+ edit arcs).
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const fail = [];
const log = (...a) => console.log(...a);

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

// schema bumped to 5
const schema = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).version);
log('schema:', schema);
if (schema !== 5) fail.push('schema not 5 (' + schema + ')');

// ---------- 1. MULTI-STAT QUEST: XP to each stat in full ----------
await p.click('.tab[data-v="quests"]');
await p.waitForTimeout(150);
await p.click('#addQuest'); await p.waitForTimeout(200);
await p.fill('#qmName', 'Japanese multi');
// default-selected is STR; build INT+FOC, drop STR
await p.click('#qmStats .sp[data-k="INT"]');
await p.click('#qmStats .sp[data-k="FOC"]');
await p.click('#qmStats .sp[data-k="STR"]');   // removes STR (length>1)
await p.fill('#qmXp', '20');
await p.click('#qmSave'); await p.waitForTimeout(300);
const created = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  const q = s.quests.find(x => x.t === 'Japanese multi');
  return { stats: q && q.stats, stat: q && q.stat, id: q && q.id };
});
log('created multi-stat:', JSON.stringify(created));
if (!created.stats || created.stats.join(',') !== 'INT,FOC') fail.push('multi-stat not saved as INT,FOC: ' + JSON.stringify(created.stats));

const pre = await ls();
const intB = pre.statXP.INT, focB = pre.statXP.FOC, totB = pre.totalXP;
await p.click('#questList .quest[data-id="' + created.id + '"] .check');
await dismiss();
const post = await ls();
log('XP int', intB, '->', post.statXP.INT, '| foc', focB, '->', post.statXP.FOC, '| total', totB, '->', post.totalXP);
if (post.statXP.INT !== intB + 20) fail.push('INT did not gain full 20');
if (post.statXP.FOC !== focB + 20) fail.push('FOC did not gain full 20');
if (post.totalXP !== totB + 20) fail.push('total should rise by 20 once, got ' + (post.totalXP - totB));
// card shows two stat tags
const tagCount = await p.$$eval('#questList .quest[data-id="' + created.id + '"] .tagstat', n => n.length);
if (tagCount !== 2) fail.push('expected 2 stat tags on card, got ' + tagCount);
// undo
await p.click('#questList .quest[data-id="' + created.id + '"] .check');
await p.waitForTimeout(300);
const undo = await ls();
if (undo.statXP.INT !== intB || undo.statXP.FOC !== focB || undo.totalXP !== totB) fail.push('multi-stat undo did not refund both stats');

// ---------- 2. EVENTS ----------
await p.click('.qtab[data-q="event"]'); await p.waitForTimeout(200);
// seeded example event present
const seededEvent = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.some(x => x.type === 'event'));
if (!seededEvent) fail.push('no seeded example event');
await p.click('#addQuest'); await p.waitForTimeout(200);
// type should default to event on this tab
const evType = await p.evaluate(() => document.querySelector('#qmType .segopt.on').dataset.t);
if (evType !== 'event') fail.push('add on events tab did not default to event type (' + evType + ')');
const whenVisible = await p.isVisible('#qmWhen');
if (!whenVisible) fail.push('WHEN field not visible for event');
await p.fill('#qmName', 'Driving lesson');
await p.fill('#qmWhen', '2026-12-01T14:30');
await p.fill('#qmNote', 'with instructor');
await p.fill('#qmXp', '40');
await p.click('#qmSave'); await p.waitForTimeout(300);
const ev = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.find(x => x.t === 'Driving lesson'));
log('event:', JSON.stringify({ type: ev && ev.type, when: ev && ev.when, note: ev && ev.note }));
if (!ev || ev.type !== 'event' || ev.when !== '2026-12-01T14:30' || ev.note !== 'with instructor') fail.push('event not saved correctly');
// attend it → XP rises
const evTot = (await ls()).totalXP;
await p.click('#questList .quest[data-id="' + ev.id + '"] .check'); await dismiss();
let evs = await ls();
const evNow = evs.quests.find(x => x.id === ev.id);
if (!evNow.attended) fail.push('event not marked attended');
if (evs.totalXP !== evTot + 40) fail.push('attending event did not add 40 XP: ' + (evs.totalXP - evTot));
// moves to ATTENDED section (still rendered)
const attendedShown = await p.isVisible('#questList .quest[data-id="' + ev.id + '"].claimed');
if (!attendedShown) fail.push('attended event not styled/shown');
// un-attend refunds
await p.click('#questList .quest[data-id="' + ev.id + '"] .check'); await p.waitForTimeout(300);
evs = await ls();
if (evs.totalXP !== evTot) fail.push('un-attend did not refund');

// daily tab must NOT show events
await p.click('.qtab[data-q="daily"]'); await p.waitForTimeout(150);
const eventInDaily = await p.isVisible('#questList .quest[data-id="' + ev.id + '"]');
if (eventInDaily) fail.push('event leaked into daily tab');

// ---------- 3. ARC SUB-QUESTS ----------
await p.click('.tab[data-v="arcs"]'); await p.waitForTimeout(200);
// seeded sub-quest arc (Master of Strings) renders a checklist
const seededSubs = await p.$$eval('.arc .subq', n => n.length);
log('seeded sub-quest rows:', seededSubs);
if (seededSubs < 4) fail.push('seeded sub-quest arc missing checklist');

await p.click('#addArc'); await p.waitForTimeout(200);
await p.fill('#amName', 'Learn a song');
await p.fill('#amSubs', 'Learn notes\nMatch tempo\nPlay clean');
// need field appears in sub mode
await p.waitForTimeout(150);
const needVisible = await p.isVisible('#amNeed');
if (!needVisible) fail.push('REQUIRED field not shown in sub-quest mode');
const numHidden = await p.evaluate(() => getComputedStyle(document.getElementById('amNumRow')).display === 'none');
if (!numHidden) fail.push('numeric row not hidden in sub-quest mode');
await p.fill('#amNeed', '2');
await p.click('#amSave'); await p.waitForTimeout(300);
const arc = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).arcs.find(a => a.t === 'Learn a song'));
log('sub arc:', JSON.stringify({ subs: arc && arc.subs.length, need: arc && arc.need, tar: arc && arc.tar }));
if (!arc || arc.subs.length !== 3 || arc.need !== 2) fail.push('sub-quest arc not saved (need=2, 3 subs)');

// toggle 2 sub-quests → arc completes (+300)
const arcTot = (await ls()).totalXP;
const subIds = arc.subs.map(s => s.id);
await p.click('.arc[data-id="' + arc.id + '"] .subq[data-sub="' + subIds[0] + '"]'); await p.waitForTimeout(250);
let afterOne = await p.evaluate((id) => JSON.parse(localStorage.getItem('system_rpg_v1')).arcs.find(a => a.id === id), arc.id);
if (afterOne.done) fail.push('arc completed after only 1/2 sub-quests');
await p.click('.arc[data-id="' + arc.id + '"] .subq[data-sub="' + subIds[1] + '"]'); await dismiss();
let afterTwo = await ls();
const arcNow = afterTwo.arcs.find(a => a.id === arc.id);
log('after 2 subs: done=', arcNow.done, 'cur/tar=', arcNow.cur + '/' + arcNow.tar, 'xp+', afterTwo.totalXP - arcTot);
if (!arcNow.done) fail.push('arc did not complete at need=2');
if (afterTwo.totalXP !== arcTot + 300) fail.push('arc clear bonus not +300: ' + (afterTwo.totalXP - arcTot));

// ---------- 4. EDIT ARC ----------
await p.click('.arc[data-id="' + arc.id + '"] [data-act="edit"]'); await p.waitForTimeout(250);
const amTitle = await p.textContent('#amTitle');
if (!/EDIT/.test(amTitle)) fail.push('arc editor title not EDIT');
const nameVal = await p.inputValue('#amName');
if (nameVal !== 'Learn a song') fail.push('arc editor not prefilled');
await p.fill('#amName', 'Learn a riff');
await p.click('#amSave'); await p.waitForTimeout(300);
const renamed = await p.evaluate((id) => JSON.parse(localStorage.getItem('system_rpg_v1')).arcs.find(a => a.id === id).t, arc.id);
if (renamed !== 'Learn a riff') fail.push('arc rename did not persist (' + renamed + ')');
// edited arc keeps its sub-quests (done state preserved by title match)
const keptSubs = await p.evaluate((id) => { const a = JSON.parse(localStorage.getItem('system_rpg_v1')).arcs.find(x => x.id === id); return { n: a.subs.length, done: a.subs.filter(s => s.done).length }; }, arc.id);
log('edited arc subs:', JSON.stringify(keptSubs));
if (keptSubs.n !== 3 || keptSubs.done !== 2) fail.push('edit dropped sub-quest done state');

// ---------- 5. delete-a-stat remaps multi-stat quests ----------
await p.click('.tab[data-v="system"]'); await p.waitForTimeout(150);
p.on('dialog', d => d.accept());
await p.click('#statManager .statrow[data-k="INT"] [data-act="delstat"]'); await p.waitForTimeout(300);
const remapped = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  const q = s.quests.find(x => x.t === 'Japanese multi');
  return { stats: q.stats, intGone: !s.stats.some(x => x.k === 'INT') };
});
log('after delete INT:', JSON.stringify(remapped));
if (!remapped.intGone) fail.push('INT not deleted');
if (remapped.stats.indexOf('INT') >= 0) fail.push('multi-stat quest still references deleted INT');

await p.screenshot({ path: 'shots/13-v5.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== V5 RESULT =====');
if (!fail.length) log('ALL V5 CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
