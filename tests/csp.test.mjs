// Item 4: CSP sem 'unsafe-inline' e nada inline no que é servido (HTML, JS gerado e páginas de login/admin).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { montar } from './helpers/harness.mjs';
import { PG_LOGIN, PG_ADMIN, JS_LOGIN, JS_ADMIN } from '../src/pages.js';

const ROOT = new URL('../', import.meta.url);
function htmlsServidos() {
  const out = [], pub = new URL('public/', ROOT).pathname;
  (function anda(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) anda(f); else if (f.endsWith('.html') && !f.endsWith('.standalone.html')) out.push(f); } })(pub);
  return out;
}
function semInline(nome, h) {
  assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)[^>]*>/i, nome + ': <script> inline');
  assert.doesNotMatch(h, /<style[\s>]/i, nome + ': <style> inline');
  assert.doesNotMatch(h, /\sstyle\s*=\s*["']/i, nome + ': atributo style=');
  assert.doesNotMatch(h, /\son[a-z]+\s*=\s*["']/i, nome + ': handler on*=');
  assert.doesNotMatch(h, /javascript:/i, nome + ': javascript: URL');
}

test('cabeçalho CSP sem unsafe-inline em página, API e arquivos', async () => {
  const h = await montar();
  for (const [p, as] of [['/login', 'anon'], ['/', 'admin'], ['/api/me', 'admin'], ['/js/app.js', 'admin'], ['/portal/login.css', 'anon']]) {
    const r = await h.call(p, { as, headers: { Accept: 'text/html' } });
    const csp = r.headers.get('Content-Security-Policy');
    assert.ok(csp, p); assert.doesNotMatch(csp, /unsafe-inline/, p);
    assert.match(csp, /script-src 'self'/); assert.match(csp, /style-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  }
});

test('HTML servido não tem script, estilo nem handler inline', () => {
  const lista = htmlsServidos();
  assert.ok(lista.some(f => f.endsWith('index.html')));
  for (const f of lista) semInline(f, fs.readFileSync(f, 'utf8'));
  semInline('PG_LOGIN', PG_LOGIN); semInline('PG_ADMIN', PG_ADMIN);
  assert.doesNotMatch(JS_LOGIN + JS_ADMIN, /style=|\.innerHTML\s*=\s*[^;]*style/);
});

test('JS do painel não gera style="" (seria bloqueado pela CSP)', () => {
  for (const f of fs.readdirSync(new URL('public/js/', ROOT))) {
    if (f === 'dados-kanzo.js') continue;
    const s = fs.readFileSync(new URL('public/js/' + f, ROOT), 'utf8');
    assert.doesNotMatch(s, /style=\\?["']/, f);
    assert.doesNotMatch(s, /setAttribute\(\s*["']style/, f);
  }
});

test('CSS de login/admin servido sem login; dashboard antigo (v2, script inline) fora do bundle', async () => {
  const h = await montar();
  for (const p of ['/portal/login.css', '/portal/admin.css']) {
    const r = await h.call(p, { as: 'anon' });
    assert.equal(r.status, 200, p); assert.match(r.headers.get('Content-Type'), /text\/css/); assert.match(r.text, /\{/);
  }
  assert.match(PG_LOGIN, /href="\/portal\/login\.css"/); assert.match(PG_ADMIN, /href="\/portal\/admin\.css"/);
  const ARQ = (await import('../assets.js')).default;
  assert.ok(ARQ['/index.html'] && ARQ['/js/estilos-dinamicos.js'] && ARQ['/js/kanzo-core.js']);
  assert.equal(ARQ['/dashboard.html'], undefined); assert.equal(ARQ['/js/tools.js'], undefined);
});
