// Testes dos campos editáveis e do motor de edição (node --test tests/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function carregar() {
  const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map, Promise, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout, Uint8Array };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['public/js/dados-kanzo.js', 'public/js/kanzo-core.js', 'public/js/format.js', 'public/js/kpi.js', 'public/js/fields.js', 'public/js/store.js'])
    vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = carregar();
const FL = ctx.KanzoFields, F = ctx.KanzoFmt, K = ctx.KanzoKPI, SNAP = ctx.KANZO_SNAPSHOT;
const arr = (x) => Array.from(x);

test('lê os campos reais do card 2 (Planner)', () => {
  const c = SNAP.cards.find(x => x.id === 2);
  assert.deepEqual(arr(FL.get(c.description, 'responsaveis')), ['Guilherme Romio Netto', 'Michael Gouvea']);
  assert.equal(FL.get(c.description, 'prazo'), '2026-08-31');
  assert.equal(FL.prazo(c.description).fonte, 'Planner');
  assert.equal(FL.get(c.description, 'solucao'), '');
  assert.equal(FL.get(c.description, 'tcv'), null);
});

test('gravar e ler de volta todos os campos, sem perder o resto da descrição', () => {
  const c = SNAP.cards.find(x => x.id === 2);
  let d = c.description;
  d = FL.set(d, 'responsaveis', 'Guilherme Romio Netto, Michael Gouvea, Ana Souza');
  d = FL.set(d, 'solucao', 'Rede privativa / 5G');
  d = FL.set(d, 'prazo', '15/12/2026');
  d = FL.set(d, 'saude', 'Atenção');
  d = FL.set(d, 'situacao', 'Assessment feito\nem Belo Jardim');
  d = FL.set(d, 'proxima', 'Enviar proposta');
  d = FL.set(d, 'tcv', '69.033,32');
  d = FL.set(d, 'mrc', '5 mil');
  assert.deepEqual(arr(FL.get(d, 'responsaveis')), ['Guilherme Romio Netto', 'Michael Gouvea', 'Ana Souza']);
  assert.equal(FL.get(d, 'solucao'), 'Rede privativa / 5G');
  assert.equal(FL.get(d, 'prazo'), '2026-12-15');
  assert.equal(FL.prazo(d).fonte, 'Kanzo');
  assert.equal(FL.prazo(d).planner, '2026-08-31', 'Datas Planner ficam como histórico');
  assert.equal(FL.get(d, 'situacao'), 'Assessment feito em Belo Jardim');
  assert.equal(FL.get(d, 'tcv'), 69033.32);
  assert.equal(FL.get(d, 'mrc'), 5000);
  // o resto do texto continua lá
  assert.ok(d.includes('**Notas:**') && d.includes('PRECIFICAR - GRUPO MOURA'));
  assert.ok(d.includes('**Datas Planner:** Criado em: 2026-05-13'));
  // novas linhas entram no cabeçalho, antes das Notas
  assert.ok(d.indexOf('**Solução / Escopo:**') < d.indexOf('**Notas:**'));
  // o parser do Worker e do painel enxerga os mesmos valores
  const v = F.valoresDaDescricao(d);
  assert.equal(v.tcv, 69033.32); assert.equal(v.mrc, 5000);
  const fx = F.fatos(d);
  assert.equal(fx.prazo, '2026-12-15'); assert.equal(fx.saude, 'Atenção'); assert.equal(fx.escopo, 'Rede privativa / 5G');
  // apagar remove a linha
  const d2 = FL.set(FL.set(d, 'saude', ''), 'mrc', null);
  assert.equal(FL.get(d2, 'saude'), ''); assert.equal(FL.get(d2, 'mrc'), null); assert.equal(FL.get(d2, 'tcv'), 69033.32);
  const d3 = FL.set(d2, 'tcv', null);
  assert.ok(!d3.includes(FL.BLOCO_VALORES), 'bloco vazio some');
});

test('regex do Worker reconhece a linha de solução gravada', () => {
  const d = FL.set('**Responsáveis:** A', 'solucao', 'DIA / Link dedicado');
  const m = d.match(/\*\*Solu[cç][aã]o \/ Escopo:\*\*\s*(.+)/i);
  assert.equal(m[1].trim(), 'DIA / Link dedicado');
});

test('valor da proposta fica só leitura; o do bloco Kanzo é editável', () => {
  const comValor = SNAP.cards.filter(c => c.values && c.values.tcv != null);
  for (const c of comValor) {
    assert.equal(FL.editavel(c.description, 'tcv').ok, false, 'card ' + c.id);
    assert.match(FL.editavel(c.description, 'tcv').motivo, /proposta/);
  }
  const d = FL.set('', 'tcv', 1000);
  assert.equal(FL.editavel(d, 'tcv').ok, true);
  assert.equal(FL.dinheiro(d, 'tcv').origem, 'bloco');
});

test('dinheiro em formato brasileiro', () => {
  const p = FL.parseDinheiro;
  assert.equal(p('69.033,32'), 69033.32); assert.equal(p('R$ 1.311.626,64'), 1311626.64);
  assert.equal(p('69033.32'), 69033.32); assert.equal(p('69 mil'), 69000); assert.equal(p('1,2 mi'), 1200000);
  assert.equal(p('200k'), 200000); assert.equal(p('1.000'), 1000); assert.equal(p(''), null); assert.ok(Number.isNaN(p('abc')));
  assert.equal(FL.fmtDinheiro(1311626.64), 'R$ 1.311.626,64'); assert.equal(FL.fmtDinheiro(5), 'R$ 5,00');
});

test('validação orienta sem bloquear, e só barra valor ilegível', () => {
  const eq = [{ nome: 'Guilherme Romio Netto' }];
  assert.equal(FL.validar('tcv', 'abc')[0].nivel, 'erro');
  assert.equal(FL.validar('tcv', '10 mil')[0].nivel, 'ok');
  assert.equal(FL.validar('prazo', '2026-01-01', { hoje: '2026-11-09' })[0].nivel, 'aviso');
  assert.equal(FL.validar('prazo', '31/02', { hoje: '2026-11-09' })[0].nivel, 'erro');
  assert.equal(FL.validar('responsaveis', 'Guilherme Romio Netto', { equipe: eq }).length, 0);
  assert.equal(FL.validar('responsaveis', 'guilherme romio netto', { equipe: eq }).length, 0, 'sem acento/caixa');
  assert.equal(FL.validar('responsaveis', 'Fulano', { equipe: eq })[0].nivel, 'aviso');
});

test('equipe vem só dos cards (Responsáveis e Criado por)', () => {
  const eq = FL.equipe(SNAP.cards);
  assert.ok(eq.length > 0);
  const todos = new Set();
  SNAP.cards.forEach(c => { F.fatos(c.description).lista.forEach(x => { if (/^(Respons|Criado por)/.test(x.rotulo)) x.valor.split(',').forEach(n => todos.add(n.trim())); }); });
  eq.forEach(p => assert.ok(todos.has(p.nome), p.nome + ' não está nos dados'));
  assert.ok(FL.buscar(eq, 'gou', 'nome').some(p => /Gouvea/.test(p.nome)));
});

test('faltas batem com os indicadores de Qualidade', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const cards = SNAP.cards.map(c => Object.assign({}, c, { values: {} }));
  const k = K.compute(cards, SNAP.stages, now);
  const conta = (id) => k.list.filter(c => arr(FL.faltas(c)).includes(id)).length;
  assert.equal(conta('solucao'), k.qualidade.semSolucao.length);
  assert.equal(conta('valor'), k.qualidade.semValor.length);
  assert.equal(conta('prazo'), k.qualidade.semPrazo.length);
  assert.equal(conta('responsavel'), k.qualidade.semResponsavel.length);
});

/* ---------- motor de edição ---------- */
function servidorFalso(cards) {
  const db = new Map(cards.map(c => [String(c.id), JSON.parse(JSON.stringify(c))]));
  const s = { db, gets: 0, patches: [], falhas: [], get: async (id) => { s.gets++; const c = db.get(String(id)); if (!c) { const e = new Error('404'); e.status = 404; throw e; } return JSON.parse(JSON.stringify(c)); },
    patch: async (id, body) => { const f = s.falhas.shift(); if (f) { const e = new Error(f.msg || 'falha'); e.status = f.status; throw e; } s.patches.push({ id, body }); const c = db.get(String(id)); c.description = body.description; c.pending = true; return c; } };
  return s;
}
const espera = () => new Promise(r => setTimeout(r, 8));
function relogioFalso() {
  let t = 1_000_000, fila = [];
  return { now: () => t, setTimeout: (f, ms) => { const h = { f, at: t + ms }; fila.push(h); return h; }, clearTimeout: (h) => { fila = fila.filter(x => x !== h); },
    async avancar(ms) { const fim = t + ms; for (;;) { fila.sort((a, b) => a.at - b.at); const h = fila[0]; if (!h || h.at > fim) break; fila.shift(); t = h.at; h.f(); await espera(); } t = fim; await espera(); } };
}
const card = () => ({ id: 2, title: 'MOURA', status: 'todo', stage: 'precificacao', description: SNAP.cards.find(x => x.id === 2).description, pending: false });

test('autosave com debounce: várias teclas viram um PATCH só', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 450 });
  const c = card();
  st.edit(c, 'saude', 'A'); st.edit(c, 'saude', 'At'); st.edit(c, 'saude', 'Atenção');
  assert.equal(st.efetivo(c).description.includes('**Saúde:** Atenção'), true, 'optimistic: tela já mostra');
  await rel.avancar(300); assert.equal(srv.patches.length, 0);
  await rel.avancar(300); assert.equal(srv.patches.length, 1);
  assert.equal(st.entrada(2, 'saude').state, 'saved');
  assert.ok(srv.patches[0].body.expect_description_sha256.length === 64);
  assert.equal(st.historico().length, 1);
});

test('erro de rede: tenta de novo sozinho e salva', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  srv.falhas.push({ status: 0, msg: 'sem rede' }, { status: 503 });
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  st.edit(card(), 'proxima', 'Ligar para o cliente', { imediato: true });
  await rel.avancar(10); assert.equal(st.entrada(2, 'proxima').state, 'retry');
  await rel.avancar(900); assert.equal(st.entrada(2, 'proxima').state, 'retry');
  await rel.avancar(3000); assert.equal(st.entrada(2, 'proxima').state, 'saved');
  assert.equal(srv.patches.length, 1);
});

test('erro 403: sem retry, a tela volta ao valor do Kanzo e o erro fica para decidir', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  srv.falhas.push({ status: 403, msg: 'Somente o admin pode alterar.' });
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  const c = card();
  st.edit(c, 'saude', 'Em risco', { imediato: true });
  await rel.avancar(10);
  const e = st.entrada(2, 'saude');
  assert.equal(e.state, 'error'); assert.match(e.error, /admin/);
  assert.equal(st.efetivo(c).description.includes('Em risco'), false, 'rollback visual');
  st.tentarDeNovo('2'); await rel.avancar(10);
  assert.equal(st.entrada(2, 'saude').state, 'saved');
});

test('conflito: o campo mudou no Kanzo durante a edição', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  const c = card();
  st.edit(c, 'responsaveis', 'Guilherme Romio Netto', { imediato: true });
  srv.db.get('2').description = FL.set(srv.db.get('2').description, 'responsaveis', 'Michael Gouvea, Henrique');
  await rel.avancar(10);
  const e = st.entrada(2, 'responsaveis');
  assert.equal(e.state, 'conflict'); assert.deepEqual(arr(e.server), ['Michael Gouvea', 'Henrique']);
  assert.equal(srv.patches.length, 0, 'não sobrescreve sem perguntar');
  st.resolver(c, 'responsaveis', 'meu'); await rel.avancar(10);
  assert.equal(srv.patches.length, 1);
  assert.deepEqual(arr(FL.get(srv.db.get('2').description, 'responsaveis')), ['Guilherme Romio Netto']);
});

test('outro campo mudou no Kanzo: grava em cima da versão nova, sem apagar a mudança alheia', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  st.edit(card(), 'saude', 'Atenção', { imediato: true });
  srv.db.get('2').description = FL.set(srv.db.get('2').description, 'proxima', 'Mudado no Mac');
  await rel.avancar(10);
  const d = srv.db.get('2').description;
  assert.equal(FL.get(d, 'saude'), 'Atenção'); assert.equal(FL.get(d, 'proxima'), 'Mudado no Mac');
});

test('espelho volta o valor antigo antes do Mac aplicar: a próxima edição não apaga a anterior', async () => {
  const original = card().description;
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  st.edit(card(), 'saude', 'Atenção', { imediato: true }); await rel.avancar(10);
  srv.db.get('2').description = original; // push do Mac sobrescreveu o espelho
  st.edit(card(), 'proxima', 'Enviar proposta', { imediato: true }); await rel.avancar(10);
  const d = srv.db.get('2').description;
  assert.equal(FL.get(d, 'saude'), 'Atenção', 'edição anterior preservada');
  assert.equal(FL.get(d, 'proxima'), 'Enviar proposta');
});

test('comando perdido no sync (superseded): reenvia uma vez sozinho', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  const c = card();
  st.edit(c, 'saude', 'Atenção', { imediato: true }); await rel.avancar(10);
  await rel.avancar(5000);
  // Mac fez push sem o comando: card sem a linha, pending=false, fila vazia
  srv.db.get('2').description = card().description; srv.db.get('2').pending = false;
  st.reconciliar([Object.assign(card(), { pending: false })], { last_push_at: new Date(rel.now()).toISOString(), pending_commands: 0 });
  await rel.avancar(10);
  assert.equal(srv.patches.length, 2, 'reenviou');
  // agora o Mac aplicou
  st.reconciliar([Object.assign(card(), { description: srv.db.get('2').description, pending: false })], { last_push_at: new Date(rel.now() + 1000).toISOString(), pending_commands: 0 });
  assert.equal(st.entrada(2, 'saude').state, 'applied');
});

test('desfazer e histórico limitado a 15', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0 });
  for (let i = 0; i < 20; i++) { st.edit(card(), 'proxima', 'Passo ' + i, { imediato: true }); await rel.avancar(10); }
  assert.equal(st.historico().length, 15);
  const h = st.historico()[0];
  assert.equal(h.depois, 'Passo 19'); assert.equal(h.antes, 'Passo 18');
  const porId = { '2': Object.assign(card(), { description: srv.db.get('2').description }) };
  assert.equal(st.desfazer(h.id, porId), 1); await rel.avancar(10);
  assert.equal(FL.get(srv.db.get('2').description, 'proxima'), 'Passo 18');
});

test('voltar ao valor original antes do debounce cancela o salvamento', async () => {
  const srv = servidorFalso([card()]), rel = relogioFalso();
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 450 });
  st.edit(card(), 'saude', 'Atenção'); st.edit(card(), 'saude', '');
  await rel.avancar(1000);
  assert.equal(srv.patches.length, 0); assert.equal(st.entrada(2, 'saude'), undefined);
});

test('pendências sobrevivem a recarregar a página (localStorage)', async () => {
  const mem = {}; const storage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const srv = servidorFalso([card()]), rel = relogioFalso();
  srv.falhas.push({ status: 0 }, { status: 0 }, { status: 0 }, { status: 0 });
  const st = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0, storage });
  st.edit(card(), 'saude', 'Atenção', { imediato: true }); await rel.avancar(20000);
  assert.equal(st.entrada(2, 'saude').state, 'error');
  const st2 = ctx.KanzoStore.create({ api: srv, now: rel.now, setTimeout: rel.setTimeout, clearTimeout: rel.clearTimeout, debounceMs: 0, storage });
  assert.equal(st2.entrada(2, 'saude').value, 'Atenção');
  st2.tentarDeNovo('2'); await rel.avancar(10);
  assert.equal(st2.entrada(2, 'saude').state, 'saved');
});

test('campo da proposta recusa edição', () => {
  const c = SNAP.cards.find(x => x.values && x.values.tcv != null);
  const st = ctx.KanzoStore.create({ api: servidorFalso([c]) });
  assert.throws(() => st.edit(c, 'tcv', 1), /proposta/);
});
