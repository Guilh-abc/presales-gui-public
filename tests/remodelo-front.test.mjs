// Remodelo 11/11/2026: Carteira primeiro, card na ordem da decisão, tarefas no card, nome novo, celular e PWA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const ler = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
function ctxTarefas() {
  const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map }; ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['public/js/kanzo-core.js', 'public/js/tarefas.js']) vm.runInContext(ler(f), ctx, { filename: f });
  return ctx.KanzoTarefas;
}
const AGORA = Date.parse('2026-11-11T15:00:00Z'); // 12:00 em Brasília

test('nome oficial e curto: título, manifest do app, cabeçalho; sem "Kanzo Dashboard"', () => {
  const html = ler('public/index.html');
  assert.match(html, /<title>Plataforma - Controle Geral de Pré Venda<\/title>/);
  assert.match(html, /class="nome-longo">Plataforma - Controle Geral de Pré Venda</);
  assert.match(html, /class="nome-curto">Controle Geral</);
  assert.match(html, /apple-mobile-web-app-title" content="Controle Geral"/);
  assert.match(html, /<link rel="manifest" href="\/app\.webmanifest"/);
  assert.match(html, /viewport-fit=cover/);
  const m = JSON.parse(ler('public/app.webmanifest'));
  assert.equal(m.name, 'Plataforma - Controle Geral de Pré Venda');
  assert.equal(m.short_name, 'Controle Geral');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  assert.ok(fs.statSync(new URL('public/icon-192.png', ROOT)).size > 500);
  for (const f of ['public/index.html', 'public/app.webmanifest', 'public/manifest.webmanifest', 'public/rapido.html']) {
    const s = ler(f);
    assert.doesNotMatch(s, /Kanzo Dashboard|Controle Geral de Pré-vendas|Especialista consultor/, f);
  }
  assert.notEqual(JSON.parse(ler('public/manifest.webmanifest')).short_name, 'Pré-vendas');
});

test('Carteira é o item 1, abre por padrão e tem o Exige ação; Resumo sem Exige ação; sem textos de espelho do Mac', () => {
  const html = ler('public/index.html');
  const iCart = html.indexOf('id="carteira"'), iRes = html.indexOf('id="resumo"'), iAcao = html.indexOf('id="acao-panel"');
  assert.ok(iCart > 0 && iCart < iRes, 'Carteira antes do Resumo');
  assert.ok(iAcao > iCart && iAcao < iRes, 'Exige ação dentro da Carteira');
  assert.doesNotMatch(html, /aria-label="Visões do painel"|class="tabs"|id="visoes"|id="tab-carteira"/, 'um menu só (sem a segunda barra de abas)');
  assert.deepEqual([...html.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]), ['carteira', 'resumo', 'funil', 'saude', 'qualidade']);
  assert.doesNotMatch(html, /espelhad|id="sync-badge"|sync com Kanzo/i);
  assert.match(html, /<script src="js\/tarefas\.js"><\/script>\s*<script src="js\/app\.js">/);
  assert.match(html, /href="css\/remodelo\.css"/);
  const app = ler('public/js/app.js');
  assert.match(app, /visao: "carteira"/);
  assert.match(app, /VISOES = \["carteira", "resumo", "funil", "saude", "qualidade"\]/);
  assert.match(app, /setVisao\(VISOES\.indexOf\(h0\) >= 0 \|\| h0 === "solucoes" \? h0 : "carteira"/, 'abre na Carteira');
  assert.match(ler('public/css/remodelo.css'), /body\[data-visao\] main>\.sec\{display:none\}/);
  assert.doesNotMatch(app, /O Mac espelha|O Mac aplica|Projeto criado na nuvem/);
  assert.match(app, /kanzo-view-m/, 'celular guarda a própria visão (lista por padrão)');
});

test('card na ordem da decisão: etapa/status/saúde/prazo, situação+próxima, tarefas, responsáveis/solução, valores, comentários', () => {
  const app = ler('public/js/app.js');
  const ini = app.indexOf('function renderDrawer('), fim = app.indexOf('function carregarHistorico(');
  const r = app.slice(ini, fim);
  const pos = ['class="dblk dec"', 'E.fieldHtml(r, "situacao"', 'E.fieldHtml(r, "proxima"', 'tarefasHtml(c)', 'E.fieldHtml(r, "responsaveis"', '["tcv", "mrc", "otc"]', 'commentsHtml('].map((s) => r.indexOf(s));
  pos.forEach((p, i) => assert.ok(p > 0, 'achou trecho ' + i));
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], 'ordem ' + i);
  assert.match(r, /data-usar-sit/, 'oferece salvar o texto narrativo como situação');
  assert.doesNotMatch(r, /id="f-stage"|id="f-status"/, 'etapa e status saíram de "Mais campos"');
});

test('narrativa: texto solto do card vira proposta de situação; tabelas e rótulos não', () => {
  const T = ctxTarefas();
  const desc = '**Responsáveis:** Ana\n**Solução:** SD-WAN\n\nCliente nao assinou na epoca por causa de orçamento; retomar em 2027.\n\n| TCV | 100 |\n|---|---|\n- [ ] checklist';
  assert.equal(T.narrativa(desc), 'Cliente nao assinou na epoca por causa de orçamento; retomar em 2027.');
  assert.equal(T.narrativa('**Responsáveis:** Ana\n| a | b |'), '');
  assert.equal(T.narrativa('curto'), '');
  assert.ok(T.narrativa('x'.repeat(2000)).length <= 421);
});

test('sugestões da etapa: Starlink só para satélite; troca de etapa sugere as novas sem apagar as pessoais', () => {
  const T = ctxTarefas();
  const keys = (l) => JSON.parse(JSON.stringify(l.map((s) => s.key)));
  assert.deepEqual(keys(T.sugestoesPendentes({ stage: 'precificacao', solution: 'SD-WAN' }, [])), ['pricing-montado']);
  assert.deepEqual(keys(T.sugestoesPendentes({ stage: 'precificacao', solution: 'Starlink (Satellite)' }, [])), ['pricing-montado', 'pricing-starlink']);
  const tasks = [{ id: 1, card_id: 9, title: 'Ligar para o cliente', source: 'user', done: 0 }, { id: 2, card_id: 9, sugg_key: 'cot-solicitada', source: 'suggestion', done: 1, done_at: '2026-11-10' }];
  assert.deepEqual(keys(T.sugestoesPendentes({ stage: 'processo-de-cotacao' }, tasks)), ['cot-recebida']);
  assert.deepEqual(keys(T.sugestoesPendentes({ stage: 'apresentacao-executiva' }, tasks)), ['proposta-enviada', 'feedback-registrado']);
  assert.equal(T.visiveis(tasks).length, 2, 'tarefas pessoais e feitas continuam no card');
  assert.equal(T.sugestoesPendentes({ stage: 'recebimento-do-projeto' }, []).length, 0);
});

test('Exige ação por tarefa: vencida ou de hoje entra; feita, dispensada ou futura não', () => {
  const T = ctxTarefas();
  const tasks = [
    { id: 1, card_id: 1, title: 'a', due_date: '2026-11-09' },
    { id: 2, card_id: 1, title: 'b', due_date: '2026-11-11' },
    { id: 3, card_id: 2, title: 'c', due_date: '2026-11-11', done: 1 },
    { id: 4, card_id: 3, title: 'd', due_date: '2026-11-01', dismissed: 1 },
    { id: 5, card_id: 4, title: 'e', due_date: '2026-11-12' },
    { id: 6, card_id: 5, title: 'f' }
  ];
  const u = T.urgentes(tasks, AGORA);
  assert.deepEqual([...Object.keys(u)], ["1"]);
  assert.equal(u[1][0].t.id, 1, 'mais atrasada primeiro');
  assert.equal(T.prazoTarefa(tasks[0], AGORA).t, 'venceu há 2 dias');
  assert.equal(T.prazoTarefa(tasks[1], AGORA).t, 'vence hoje');
  assert.equal(T.prazoTarefa(tasks[4], AGORA).t, 'vence amanhã');
  assert.equal(T.prazoTarefa(tasks[5], AGORA), null);
});

test('bloco de tarefas: admin vê criar/editar/sugestões; leitura só a lista, sem botões', () => {
  const T = ctxTarefas();
  const card = { id: 7, stage: 'processo-aprovacao-precificacao', solution: 'SD-WAN' };
  const tasks = [{ id: 1, card_id: 7, title: 'Enviar <b>pricing</b>', due_date: '2026-11-10', source: 'user' }];
  const adm = T.blocoHtml(card, tasks, { cw: true, agora: AGORA });
  assert.match(adm, /data-tk-form="nova"/);
  assert.match(adm, /data-sg="pricing-aprovado"/);
  assert.match(adm, /role="checkbox"/);
  assert.match(adm, /Enviar &lt;b&gt;pricing&lt;\/b&gt;/, 'título escapado');
  const lei = T.blocoHtml(card, tasks, { cw: false, agora: AGORA });
  assert.doesNotMatch(lei, /<button|<form|data-sg=/);
  assert.match(lei, /venceu há 1 dia/);
});

test('CSS do remodelo: celular com navegação inferior, safe-area, alvos de 44 px e sem cores fora dos tokens', () => {
  const css = ler('public/css/remodelo.css');
  assert.match(css, /@media \(max-width:640px\)/);
  assert.match(css, /\.secnav\{position:fixed!important[^}]*bottom:0/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /\.tk-chk\{width:44px;height:44px\}/);
  assert.match(css, /\.drawer\{width:100vw/);
  assert.doesNotMatch(css, /#00ff|#0f0\b|#00f\b|#0000ff|lime/i);
});

test('produção sem MAC_SYNC: o wrangler.toml não religa o sync do Mac (agente removido em 11/11)', () => {
  assert.doesNotMatch(ler('wrangler.toml'), /MAC_SYNC/);
});
