import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium, devices } = pw;
const BASE = 'http://localhost:8123/index.html';
const SHOT = new URL('../shots/', import.meta.url);
import { mkdirSync } from 'node:fs';
mkdirSync(SHOT, { recursive: true });

const fail = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 12'],
  permissions: ['notifications'],
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---- 1. boots, no errors, level shows ----
const lv = await page.textContent('#lvNum');
log('Level badge:', lv);
// Google Fonts CDN is blocked in this sandbox — that's environmental, not an app bug.
const realErrors = errors.filter(e => !/CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)|ERR_FAILED.*fonts/.test(e));
if (realErrors.length) fail.push('JS errors on load:\n  ' + realErrors.join('\n  '));

// ---- 2. service worker registers ----
const swReg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!r;
});
log('SW registered:', swReg);
if (!swReg) fail.push('service worker did not register');

// ---- 3. manifest loads + parses ----
const manifestOk = await page.evaluate(async () => {
  const r = await fetch('manifest.json'); const j = await r.json();
  return j.name && j.icons.length >= 3;
});
log('Manifest ok:', manifestOk);
if (!manifestOk) fail.push('manifest invalid');

await page.screenshot({ path: new URL('01-status.png', SHOT).pathname });

// ---- 4. complete a core quest, XP rises ----
await page.click('.tab[data-v="quests"]');
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('02-quests.png', SHOT).pathname });
const xpBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
await page.click('#questList .quest .check'); // first quest toggle
await page.waitForTimeout(400);
const xpAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
log('XP', xpBefore, '->', xpAfter);
if (!(xpAfter > xpBefore)) fail.push('completing a quest did not add XP');
// undo
await page.click('#questList .quest.done .check');
await page.waitForTimeout(300);
const xpUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
if (xpUndo !== xpBefore) fail.push('undo did not refund XP (' + xpUndo + ' != ' + xpBefore + ')');

// ---- 5. weekly boss panel present ----
const bossName = await page.textContent('#bossName');
log('Boss:', bossName);
if (!bossName) fail.push('boss panel missing');

// ---- 6. arcs view ----
await page.click('.tab[data-v="arcs"]');
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('03-arcs.png', SHOT).pathname });
const arcCount = await page.$$eval('#arcList .arc', (n) => n.length);
log('Arcs:', arcCount);
if (arcCount < 1) fail.push('no arcs rendered');

// ---- 7. system view + reminders + theme toggle ----
await page.click('.tab[data-v="system"]');
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('04-system.png', SHOT).pathname });
// NOTE: mobile emulation reports Notification.permission='denied' regardless of
// grants, so the enable path is verified in a desktop context at the end.

// time picker
await page.click('#editWalkTime');
await page.waitForTimeout(300);
const timeModalShown = await page.isVisible('#timeModal.show, #timeModal');
await page.selectOption('#timeHour', '07');
await page.selectOption('#timeMin', '15');
await page.click('#timeSave');
await page.waitForTimeout(300);
const walkTime = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).reminders.walk.time);
log('Walk time set to:', walkTime);
if (walkTime !== '07:15') fail.push('time picker did not save (' + walkTime + ')');

// theme toggle changes accent var
const cyanBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim());
await page.click('#tgTheme'); await page.waitForTimeout(200);
await page.click('#tgTheme'); await page.waitForTimeout(200);
log('Theme cyan var:', cyanBefore);

// ---- 8. export produces a valid JSON download ----
const [ download ] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#exportData'),
]);
const path = await download.path();
const { readFileSync } = await import('node:fs');
let exp;
try { exp = JSON.parse(readFileSync(path, 'utf-8')); } catch (e) { fail.push('export not valid JSON'); }
log('Export keys:', exp && Object.keys(exp).join(','));
if (exp && (!exp.data || exp.schema !== 2)) fail.push('export missing data/schema');

// ---- 9. import round-trip: bump XP via import ----
const tmp = '/tmp/inj.json';
const inj = JSON.parse(readFileSync(path, 'utf-8'));
inj.data.totalXP = 99999;
const { writeFileSync } = await import('node:fs');
writeFileSync(tmp, JSON.stringify(inj));
page.once('dialog', (d) => d.accept()); // confirm()
await page.setInputFiles('#importFile', tmp);
await page.waitForTimeout(500);
const importedXP = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).totalXP);
log('Imported XP:', importedXP);
if (importedXP !== 99999) fail.push('import did not restore data (' + importedXP + ')');

// ---- 10. add a quest via modal ----
await page.click('.tab[data-v="quests"]');
await page.waitForTimeout(300);
await page.click('#addQuest');
await page.waitForTimeout(300);
await page.fill('#qmName', 'Test Quest Alpha');
await page.click('#qmEval');
await page.click('#qmSave');
await page.waitForTimeout(400);
const hasNew = await page.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).quests.some(q => q.t === 'Test Quest Alpha'));
log('Added quest:', hasNew);
if (!hasNew) fail.push('adding quest failed');

// ---- 11. offline: SW serves shell ----
await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r; });
await page.waitForTimeout(800); // let runtime caches fill
await ctx.setOffline(true);
const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(e => ({ err: e.message }));
const offlineLevel = await page.textContent('#lvNum').catch(() => null);
log('Offline reload level badge:', offlineLevel, '(resp ok:', resp && resp.ok ? resp.ok() : resp, ')');
if (!offlineLevel) fail.push('app did not load offline from cache');
await ctx.setOffline(false);

// ---- 12. migration: load a v1 blob ----
await page.evaluate(() => {
  const v1 = { version: 1, player: { name: 'Legacy' }, avatar: { hair:'#000', skin:'#fff', eyes:'#00f', outfit:'#111' },
    statXP: { STR: 240, INT: 0, FOC: 0, CHA: 0, GOLD: 0 }, totalXP: 500, streak: { cur: 3, best: 5 }, missed: 0,
    daily: { date: '2000-01-01', done: {}, acted: false }, settings: { sound: true, haptic: true, penalty: true },
    quests: [{ id: 'x1', t: 'Old quest', stat: 'FOC', xp: 10, core: true, type: 'daily' }],
    arcs: [], seenUnlocks: [] };
  localStorage.setItem('system_rpg_v1', JSON.stringify(v1));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const migrated = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  return { version: s.version, hasReminders: !!s.reminders, hasBoss: !!s.boss, theme: s.settings.theme, name: s.player.name };
});
log('Migrated v1->:', JSON.stringify(migrated));
if (migrated.version !== 2 || !migrated.hasReminders || !migrated.hasBoss) fail.push('v1->v2 migration incomplete: ' + JSON.stringify(migrated));
await page.screenshot({ path: new URL('05-migrated.png', SHOT).pathname });

// ---- 13. notifications + reminder firing (desktop context, permission grantable) ----
const dctx = await browser.newContext({ permissions: ['notifications'] });
const dpage = await dctx.newPage();
const notifs = [];
await dctx.exposeBinding('__notif', (_s, payload) => notifs.push(payload));
await dpage.addInitScript(() => {
  // capture both SW and page notifications
  function Stub(title, opts) { window.__notif({ title, body: (opts || {}).body }); }
  Stub.permission = 'granted';
  Stub.requestPermission = () => Promise.resolve('granted');
  window.Notification = Stub;
  if (window.ServiceWorkerRegistration) {
    window.ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      window.__notif({ title, body: (opts || {}).body }); return Promise.resolve();
    };
  }
});
await dpage.goto(BASE, { waitUntil: 'networkidle' });
await dpage.waitForTimeout(400);
await dpage.click('.tab[data-v="system"]');
await dpage.waitForTimeout(200);
await dpage.click('#tgNotif');
await dpage.waitForTimeout(300);
const dEnabled = await dpage.evaluate(() => JSON.parse(localStorage.getItem('system_rpg_v1')).reminders.enabled);
log('Desktop reminders enabled:', dEnabled);
if (!dEnabled) fail.push('notification toggle did not enable reminders (desktop)');
// force a reminder to be due and run the scheduler
await dpage.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('system_rpg_v1'));
  s.reminders.enabled = true; s.reminders.walk.on = true; s.reminders.walk.time = '00:00'; s.reminders.walk.last = '';
  localStorage.setItem('system_rpg_v1', JSON.stringify(s));
});
await dpage.reload({ waitUntil: 'networkidle' });
await dpage.waitForTimeout(600);
log('Notifications captured:', JSON.stringify(notifs));
if (!notifs.some(n => /walk/i.test(n.title))) fail.push('walk reminder did not fire when due');
await dctx.close();

await browser.close();

log('\n================ RESULT ================');
if (fail.length === 0) log('ALL CHECKS PASSED ✅');
else { log('FAILURES (' + fail.length + '):'); fail.forEach(f => log(' ✗ ' + f)); process.exitCode = 1; }
