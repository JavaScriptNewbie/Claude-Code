// Tests bulk-paste import + Web Share Target handling.
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
await p.evaluate(() => localStorage.removeItem('system_rpg_v1'));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// 1. open paste modal from Quests view
await p.click('.tab[data-v="quests"]');
await p.waitForTimeout(200);
await p.click('#pasteList');
await p.waitForTimeout(200);
if (!(await p.isVisible('#pasteText'))) fail.push('paste modal did not open');

// 2. paste a messy list with bullets, checkboxes, due dates, xp, stat overrides
const list = [
  '- [ ] Finish Econ IA commentary 2 @2030-06-10 17:00 +70',
  '* Email Mr. Smith #CHA',
  '1. Read chapter 4 +25',
  '   ',                                   // blank -> skipped
  '--------',                              // divider -> skipped
  '[x] Buy creatine'
].join('\n');
await p.fill('#pasteText', list);
await p.waitForTimeout(150);
const preview = await p.textContent('#pastePreview');
log('Preview:', preview);
// set default stat to STR for lines without #override
await p.click('#pasteStats .sp[data-k="STR"]');
await p.fill('#pasteXp', '30');
await p.click('#pasteSave');
await p.waitForTimeout(300);

const q = await p.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.filter(x => x.source === 'paste'));
log('Imported:', JSON.stringify(q.map(x => ({ t: x.t, xp: x.xp, stat: x.stat, due: x.due })), null, 0));
if (q.length !== 4) fail.push('expected 4 bounties, got ' + q.length);
const econ = q.find(x => /Econ IA/.test(x.t));
if (!econ) fail.push('Econ line missing');
else {
  if (econ.xp !== 70) fail.push('inline +70 xp not parsed: ' + econ.xp);
  if (!/^2030-06-10T17:00$/.test(econ.due || '')) fail.push('inline due not parsed: ' + econ.due);
  if (/@|\+70/.test(econ.t)) fail.push('tokens not stripped from title: ' + econ.t);
}
const email = q.find(x => /Email Mr/.test(x.t));
if (email && email.stat !== 'CHA') fail.push('#CHA stat override not parsed: ' + (email && email.stat));
const read = q.find(x => /Read chapter/.test(x.t));
if (read && read.xp !== 25) fail.push('inline +25 not parsed: ' + (read && read.xp));
const creatine = q.find(x => /creatine/.test(x.t));
if (creatine && (creatine.xp !== 30 || creatine.stat !== 'STR')) fail.push('defaults (xp30/STR) not applied: ' + JSON.stringify(creatine));
if (creatine && /\[x\]/.test(creatine.t)) fail.push('checkbox not stripped: ' + creatine.t);

// 3. Web Share Target: arriving with ?text=... should auto-open the paste modal prefilled
await p.goto(BASE + '?text=' + encodeURIComponent('Walk the dog\nDo laundry'), { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
const shareOpen = await p.isVisible('#pasteText');
const shareVal = shareOpen ? await p.inputValue('#pasteText') : '';
log('Share-target modal open:', shareOpen, '| text:', JSON.stringify(shareVal));
if (!shareOpen) fail.push('share target did not open paste modal');
if (!/Walk the dog/.test(shareVal)) fail.push('shared text not prefilled');
// URL should be cleaned of the share params
const url = p.url();
if (/text=/.test(url)) fail.push('share params not stripped from URL: ' + url);

await p.screenshot({ path: 'shots/10-paste.png' });
const realErrs = errs.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED/.test(e));
if (realErrs.length) fail.push('JS errors:\n  ' + realErrs.join('\n  '));

await b.close();
log('\n===== PASTE/SHARE RESULT =====');
if (!fail.length) log('ALL PASTE/SHARE CHECKS PASSED ✅');
else { log('FAILURES:'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
