// Lotes do front (09/11/2026): testes de aceite de cada lote publicado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const ler = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

test('Lote 0: snapshot só no fallback, faixa sempre no lugar, nomes acessíveis e bundle sem prévias', async () => {
  const html = ler('public/index.html');
  assert.doesNotMatch(html, /<script src="js\/dados-kanzo\.js">/, 'dados-kanzo.js não pode carregar sempre');
  assert.match(ler('public/js/data-source.js'), /js\/dados-kanzo\.js/, 'fallback injeta o snapshot');
  assert.match(html, /<p id="write-note" class="note carregando"/, 'faixa visível desde o início (sem CLS)');
  assert.doesNotMatch(html, /id="write-note"[^>]*hidden/);
  for (const id of ['btn-refresh', 'btn-logout', 'btn-admin']) assert.match(html, new RegExp('id="' + id + '"[^>]*aria-label="'), id);
  assert.doesNotMatch(html, /role="tooltip"/, '#tip sem role tooltip sem nome');
  assert.doesNotMatch(ler('public/js/app.js'), /role="listitem"/, 'button com role listitem (aria-allowed-role)');
  const ARQ = (await import('../assets.js?lote0=' + Date.now())).default;
  for (const p of ['/previews/desktop-1280.png', '/previews/mobile-390.png', '/data/dashboard-data.json']) assert.equal(ARQ[p], undefined, p);
  assert.ok(ARQ['/js/dados-kanzo.js'], 'snapshot continua disponível para o fallback');
  assert.ok(fs.statSync(new URL('assets.js', ROOT)).size < 240000, 'assets.js abaixo de 240 KB'); // Lote 8: +~30 KB = fonte local (Geist desde 12/11) (woff2 em base64); antes o teto era 200 KB
});

test('Lote 1: gráficos com nome, tabela para leitor de tela e alvos de 44 px no celular', () => {
  const ch = ler('public/js/charts.js'), css = ler('public/css/styles.css'), app = ler('public/js/app.js');
  assert.match(ch, /function srTable\(/);
  assert.match(ch, /setAttribute\("role", "group"\)/);
  assert.match(ch, /createElementNS\(ns, "title"\)/, 'donut com <title>');
  assert.match(ch, /class="t" aria-hidden="true"/, 'barra decorativa fora da árvore de acessibilidade');
  assert.equal((app.match(/titulo: "/g) || []).length >= 3, true, 'funil, soluções e responsáveis com título');
  const m = css.match(/Lote 1: alvos de toque[\s\S]*?\n}\n/); assert.ok(m, 'bloco de 44 px');
  assert.match(m[0], /min-height:44px/); assert.match(m[0], /@media \(max-width:640px\)/);
  assert.doesNotMatch(css, /color:var\(--brand\)/, 'magenta não é usado como cor de texto');
});

test('Lote 2: filtros na URL (replaceState) e filtro cruzado nos gráficos', () => {
  const app = ler('public/js/app.js'), html = ler('public/index.html');
  for (const p of ['etapa', 'solucao', 'saude', 'resp', 'periodo', 'chip']) assert.match(app, new RegExp('\\b' + p + ': "'), 'parâmetro ' + p);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /new URLSearchParams\(location\.search\)/);
  assert.match(app, /"f:stage:"/); assert.match(app, /"f:fam:"/); assert.match(app, /data-act="f:status:/);
  assert.match(app, /\$\("#sr-status"\)\.textContent = /, 'anúncio aria-live do filtro');
  assert.equal((html.match(/class="fbar" hidden/g) || []).length, 3, 'barra de filtros ativos no funil, na saúde e na carteira');
  assert.match(html, /id="f-saude-filter"/); assert.match(html, /id="f-periodo-filter"/);
});

test('Lote 3: TCV por etapa e por solução somam o mesmo TCV do /api/summary; ganho separado do aberto', async () => {
  const vm = await import('node:vm');
  const { montar, board } = await import('./helpers/harness.mjs');
  const h = await montar({ entry: 'main.js' });
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() })).status, 200);
  const cards = (await h.call('/api/cards?limit=500', { as: 'viewer' })).body.cards;
  const stages = (await h.call('/api/stages', { as: 'viewer' })).body;
  const sum = (await h.call('/api/summary', { as: 'viewer' })).body;
  const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map }; ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['public/js/kanzo-core.js', 'public/js/format.js', 'public/js/kpi.js']) vm.runInContext(ler(f), ctx, { filename: f });
  const st = (Array.isArray(stages) ? stages : stages.stages || []).map((s, i) => typeof s === 'string' ? { key: s, label: s } : { key: s.key || s.id, label: s.label || s.key });
  const k = ctx.KanzoKPI.compute(cards, st, Date.parse('2026-11-09T15:00:00Z'));
  const r2 = (n) => Math.round(n * 100) / 100;
  assert.ok(sum.totals.tcv > 0, 'há TCV no cenário');
  assert.equal(r2(k.funil.reduce((s, f) => s + f.tcv, 0)), r2(sum.totals.tcv), 'TCV por etapa = totals.tcv');
  assert.equal(r2(k.tcvSoma), r2(sum.totals.tcv));
  assert.ok(r2(k.familias.reduce((s, f) => s + f.tcv, 0)) <= r2(sum.totals.tcv), 'por solução não passa do total');
  const d = k.diretoria;
  assert.equal(d.ganhosComTcv + d.abertosComTcv + d.foraTcv, k.comValor.length);
  assert.ok(d.tcvGanho + d.tcvAberto <= k.tcvSoma + 0.01);
  const app = ler('public/js/app.js');
  assert.match(app, /t: "TCV ganho"/); assert.match(app, /t: "TCV em aberto"/); assert.match(app, /v: "sem dado"/);
  assert.doesNotMatch(app, /t: "(Custo|Margem)/i, 'nenhum KPI de custo ou margem');
});

test('Lote 4: evolução mensal pelas datas do Planner, sem data contado à parte, sem closed_at', async () => {
  const vm = await import('node:vm');
  const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map }; ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['public/js/kanzo-core.js', 'public/js/format.js', 'public/js/kpi.js']) vm.runInContext(ler(f), ctx, { filename: f });
  const K = ctx.KanzoKPI, agora = Date.parse('2026-11-09T15:00:00Z');
  const dp = (a, b) => '**Datas Planner:** Criado em: ' + a + ' | Data de conclusão: 2026-12-01' + (b ? ' | Concluído em: ' + b : '');
  const cards = [
    { id: 1, title: 'A', status: 'done', stage: 'ganho-handoff', description: dp('2026-03-10', '2026-10-02') },
    { id: 2, title: 'B', status: 'doing', stage: 'x', description: dp('2026-10-20') + '\n**Saúde:** Atenção' },
    { id: 3, title: 'C', status: 'done', stage: 'x', description: 'sem datas' },
    { id: 4, title: 'D', status: 'todo', stage: 'x', description: dp('2025-01-05') },
  ];
  const k = K.compute(cards, [{ key: 'x', label: 'X' }, { key: 'ganho-handoff', label: 'G' }], agora);
  const m = k.mensal;
  assert.equal(m.meses.length, 12); assert.equal(m.meses[11].mes, '2026-11'); assert.equal(m.meses[0].mes, '2025-12');
  const por = Object.fromEntries(m.meses.map(r => [r.mes, r]));
  assert.equal(por['2026-03'].criados, 1); assert.equal(por['2026-10'].criados, 1); assert.equal(por['2026-10'].concluidos, 1);
  assert.equal(m.semCriado, 1); assert.equal(m.concluidosSemData, 1); assert.equal(m.criadosAntes, 1);
  assert.equal(k.saude.atencao, 1); assert.equal(k.saude['sem-dado'], 1);
  assert.equal(K.faixaPrazo(k.list.find(c => c.id === 2)), '30d');
  const todo = ler('public/js/app.js') + ler('public/js/kpi.js') + ler('src/cards.js');
  assert.doesNotMatch(todo, /closed_at/, 'não cria nem lê closed_at');
  const html = ler('public/index.html');
  assert.match(html, /id="mensal"/); assert.match(html, /id="saude-bars"/); assert.match(html, /id="prazo-bars"/);
});

test('Lote 5: ranking por TCV só com cards reais; tempo na etapa “sem dado”; nada de updated_at', () => {
  const app = ler('public/js/app.js'), html = ler('public/index.html');
  const fn = app.slice(app.indexOf('function renderRanking'), app.indexOf('function renderSaude'));
  assert.match(fn, /k\.comValor\.slice\(0, 10\)/, 'até 10, só quem tem TCV');
  assert.match(fn, /Dias desde a criação \(Planner\)/); assert.match(app, /sem dado<\/td>/);
  assert.doesNotMatch(fn, /updated_at|updatedAt/, 'aging não vem de updated_at');
  assert.match(fn, /data-act="open:/, 'clique abre o card');
  assert.match(html, /id="ranking"/);
});

test('Lote 6: modo apresentação (P/Esc) e PDF via @media print, sem biblioteca nova', () => {
  const app = ler('public/js/app.js'), html = ler('public/index.html'), css = ler('public/css/styles.css');
  assert.match(html, /id="btn-pres"[^>]*aria-keyshortcuts="P"/); assert.match(html, /id="btn-pdf"/);
  assert.match(app, /function apresentar\(on\)/); assert.match(app, /e\.key === "Escape" && document\.body\.classList\.contains\("apresentando"\)/);
  assert.match(app, /window\.print\(\)/);
  assert.match(css, /@media print\{/); assert.match(css, /@page\{size:A4/);
  assert.doesNotMatch(html, /dom-to-image|html2canvas/);
});

test('Lote 7: tema claro com toggle e prefers-color-scheme, paleta extra e CSP sem unsafe-inline', () => {
  const html = ler('public/index.html'), tema = ler('public/js/tema.js'), tok = ler('public/css/tokens.css'), http = ler('src/http.js');
  assert.match(html, /<script src="js\/tema\.js"><\/script>\s*<link rel="stylesheet" href="css\/tokens\.css"/, 'tema aplicado antes do CSS (sem piscar)');
  assert.match(tema, /prefers-color-scheme: light/); assert.match(tema, /localStorage/);
  assert.match(tok, /:root\[data-tema="claro"\]\{/); assert.match(tok, /--c6:.*--c7:.*--c8:/);
  assert.match(html, /id="btn-tema"[^>]*aria-pressed/); assert.match(html, /id="btn-tema-2"/);
  const csp = http.match(/export var CSP = "([^"]+)"/)[1];
  assert.doesNotMatch(csp, /unsafe-inline/); assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(html, /<script>(?!<)|<script(?![^>]*src=)[^>]*>|style="|<style/, 'nenhum script ou estilo inline no painel');
});
