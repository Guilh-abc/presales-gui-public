import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 8793;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.dirname(HERE);
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

async function waitUrl(url, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.status) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server timeout ' + url);
}

const child = spawn(process.execPath, [path.join(HERE, 'helpers/servidor-local.mjs'), String(PORT)], {
  cwd: PROJ, stdio: ['ignore', 'pipe', 'pipe']
});
let dead = false;
child.on('exit', (c) => { dead = true; console.error('server exit', c); });
child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));
await waitUrl('http://127.0.0.1:' + PORT + '/api/saude');

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ADMIN = 'A'.repeat(43), VIEW = 'V'.repeat(43);
const results = [];

async function run(role, w, h) {
  const cookie = role === 'admin' ? ADMIN : VIEW;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { Cookie: '__Host-mco=' + cookie } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e)));
  p.on('console', m => { if (m.type() === 'error' && !/404|favicon|net::/.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('#count-view', { timeout: 45000 });
  await p.waitForTimeout(800);
  await p.click('#view-board');
  await p.waitForSelector('#kanban-board:not([hidden]) .kcol', { timeout: 15000 });
  const cols = await p.locator('#kanban-board .kcol').count();
  const movers = await p.locator('select[data-mover]').count();
  const overflow = await p.evaluate(() => {
    const board = document.getElementById('kanban-board');
    const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth;
    if (sw <= cw + 4) return false;
    // se o excesso é só o quadro (scroll interno), ok
    if (board && !board.hidden && board.scrollWidth > board.clientWidth) return sw > board.scrollWidth + 24;
    return true;
  });
  if (role === 'admin') {
    await p.click('#btn-new');
    await p.waitForSelector('#new-modal:not([hidden])');
    await p.fill('#new-name', 'Playwright Lote2');
    await p.click('#new-cancel');
  } else if (movers !== 0) {
    errs.push('leitor viu Mover para: ' + movers);
  }
  results.push({ role, w, h, cols, movers, overflow, errs: errs.slice(0, 8) });
  await ctx.close();
}

try {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    await run('admin', w, h);
    await run('viewer', w, h);
  }
} finally {
  await browser.close();
  try { child.kill('SIGTERM'); } catch {}
}

console.log(JSON.stringify(results, null, 2));
const bad = results.filter(r => r.errs.length || r.cols < 5 || r.overflow || (r.role === 'admin' && r.movers < 1));
if (bad.length) { console.error('PLAYWRIGHT FALHOU'); process.exit(1); }
console.log('PLAYWRIGHT KANBAN: OK');
