// Lote 8: visual (fonte local — Geist desde a repaginação 12/11, abertura com TCV ganho, KPIs em sequência, gráficos que se desenham, apresentação em slides).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar } from './helpers/harness.mjs';

const ler = (p) => fs.readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');
const html = ler('index.html'), css = ler('css/lote8.css'), app = ler('js/app.js');

test('sem CDN nem estilo/script inline; fonte local com preload', () => {
  for (const [nome, txt] of [['index.html', html], ['lote8.css', css], ['app.js', app]]) assert.doesNotMatch(txt, /https?:\/\/(?!www\.w3\.org)/, nome + ' sem URL externa');
  assert.doesNotMatch(html, /\sstyle="|<style|<script>(?!<)/);
  /* 18/11/2026 (visual unificado): a fonte principal passou de Geist para Manrope, também local (fonts/manrope-var-latin.woff2). O Geist segue no CSS só como reserva e é servido igual. */
  assert.match(html, /<link rel="preload" href="fonts\/manrope-var-latin\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
  assert.match(ler('css/unificado.css'), /@font-face\{font-family:"Manrope";src:url\(\.\.\/fonts\/manrope-var-latin\.woff2\)[^}]*font-display:swap/);
  assert.match(css, /@font-face\{font-family:"Geist";src:url\(\.\.\/fonts\/geist-var-latin\.woff2\)[^}]*font-display:optional/);
});

test('abertura sem número fixo: tudo vem de K.compute sobre a API', () => {
  const hero = html.slice(html.indexOf('<div class="hero"'), html.indexOf('<div class="grid g-kpi"'));
  assert.doesNotMatch(hero, /R\$\s?\d|\d+ cards|1,31|1\.311/);
  assert.match(app, /function renderHero\(k\) \{\s*var d = k\.diretoria/);
  assert.match(app, /renderKPIs\(k\); renderHero\(k\);/);
});

test('movimento reduzido: sem contagem, sem entrada, gráficos prontos; impressão sem efeito', () => {
  assert.match(app, /if \(state\.heroContou \|\| RM\.matches\) \{ num\.innerHTML = heroHTML\(d\.tcvGanho, e\); return; \}/);
  assert.match(app, /if \(RM\.matches \|\| !\("IntersectionObserver" in window\)\) \{ todos\(\); return; \}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none!important/);
  assert.match(css, /@media print\{[^@]*transform:scaleX\(var\(--p,0\)\)!important/);
  assert.match(app, /addEventListener\("beforeprint", todos\)/);
});

test('slides: 6 slides, tela cheia com fallback webkit, Esc/fullscreenchange saem', () => {
  assert.equal((app.slice(app.indexOf("var SLIDES = ["), app.indexOf("], slideAt = 0")).match(/\{ nome: "/g) || []).length, 6);
  assert.match(app, /webkitRequestFullscreen/); assert.match(app, /webkitfullscreenchange/);
  assert.match(html, /id="pres-prev"/); assert.match(html, /id="pres-next"/); assert.match(html, /id="pres-count" aria-live="polite"/);
});

test('fonte servida com tipo certo e cache longo; atrás do login', async () => {
  const h = await montar({ entry: 'main.js' });
  const r = await h.call('/fonts/geist-var-latin.woff2', { as: 'viewer' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'font/woff2');
  assert.match(r.headers.get('cache-control'), /max-age=2592000/);
  assert.equal((await h.call('/fonts/geist-var-latin.woff2', { as: 'anon' })).status, 401);
  const m = await h.call('/fonts/manrope-var-latin.woff2', { as: 'viewer' });
  assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), 'font/woff2');
  assert.equal((await h.call('/fonts/manrope-var-latin.woff2', { as: 'anon' })).status, 401);
  const c = await h.call('/css/lote8.css', { as: 'viewer' }); assert.equal(c.status, 200); assert.match(c.headers.get('cache-control'), /no-cache/);
});
