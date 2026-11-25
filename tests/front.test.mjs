// Testes do front (node --test tests/). Carrega os scripts do navegador num contexto vm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {}, Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['public/js/dados-kanzo.js', 'public/js/kanzo-core.js', 'public/js/format.js', 'public/js/kpi.js']) {
  vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
const F = ctx.KanzoFmt, K = ctx.KanzoKPI, SNAP = ctx.KANZO_SNAPSHOT;

test('horário em Brasília e relativo', () => {
  const now = Date.parse('2026-11-09T11:45:56Z');
  assert.equal(F.dataHora('2026-11-09T11:42:56Z'), '09/11/2026 08:42');
  assert.equal(F.relativo('2026-11-09T11:42:56Z', now), 'há 3 min');
  assert.equal(F.relativo('2026-11-09T11:45:40Z', now), 'agora');
  assert.equal(F.relativo('2026-11-09T09:40:00Z', now), 'há 2 h');
  assert.equal(F.relativo('2026-11-06T11:00:00Z', now), 'há 3 dias');
  assert.equal(F.relativo('2026-11-14T12:00:00Z', now), 'em 5 dias');
  assert.equal(F.relativo(null, now), 'sem registro');
  assert.equal(F.relativo('lixo', now), 'sem registro');
});

test('moeda BR e compacta', () => {
  assert.equal(F.numeroBR('R$ 1.311.626,64'), 1311626.64);
  assert.equal(F.numeroBR('R$ 0,00'), 0);
  assert.equal(F.numeroBR('abc'), null);
  assert.match(F.brlCurto(1311626.64), /^R\$\s?1,31\smi$/);
  assert.match(F.brlCurto(69033.32), /^R\$\s?69,0\smil$/);
});

test('extrai TCV/MRC/OTC só de tabelas explícitas e bate com o snapshot', () => {
  const comValor = SNAP.cards.filter(c => c.values && c.values.tcv != null);
  assert.ok(comValor.length >= 4);
  for (const c of comValor) {
    const v = F.valoresDaDescricao(c.description);
    assert.equal(v.tcv, c.values.tcv, 'TCV do card ' + c.id);
    if (c.values.mrc) assert.equal(v.mrc, c.values.mrc, 'MRC do card ' + c.id);
    if (c.values.otc) assert.equal(v.otc, c.values.otc, 'OTC do card ' + c.id);
    assert.ok(v.origem.tcv.includes('R$'));
  }
  // nenhum card sem TCV no snapshot ganha TCV inventado
  for (const c of SNAP.cards.filter(c => !c.values || c.values.tcv == null)) {
    assert.equal(F.valoresDaDescricao(c.description).tcv, null, 'card ' + c.id + ' não deveria ter TCV');
  }
  // texto solto não vira valor
  assert.equal(F.valoresDaDescricao('Modelo: Opex. TCV estimado: R$ 200k (carteira).').tcv, null);
});

test('fatos da descrição: responsáveis e prazo', () => {
  const c = SNAP.cards.find(x => x.id === 2);
  const f = F.fatos(c.description);
  assert.deepEqual(Array.from(f.responsaveis), ['Guilherme Romio Netto', 'Michael Gouvea']);
  assert.equal(f.prazo, '2026-08-31');
  assert.ok(!f.lista.some(x => /Notas/.test(x.rotulo)));
  const novo = F.fatos('**Saúde:** Atenção\n**Próxima ação / Gate:** Validar SLA\n**Solução / Escopo:** DIA 1 Gbps');
  assert.equal(novo.saude, 'Atenção');
  assert.equal(novo.proxima, 'Validar SLA');
});

test('KPIs: atrasados abertos, ação, ganhos e valor', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const cards = SNAP.cards.map(c => Object.assign({}, c, { values: {} })); // como a API entrega
  const k = K.compute(cards, SNAP.stages, now);
  assert.equal(k.total, 55);
  assert.equal(k.atrasadosAbertos.length, 15);
  assert.equal(k.atrasadosTag, 15);
  assert.equal(k.abertos, 18);
  assert.ok(k.acao.every(c => c.status !== 'done'));
  assert.equal(k.acao[0].atrasado, true);
  assert.ok(k.acao.every(c => c.stage !== 'old-falhou'), 'OLD/FALHOU fora de Exige ação');
  assert.ok(k.qualidade.prazoVencido.every(c => c.stage !== 'old-falhou'));
  assert.equal(k.qualidade.perdidoAberto.length, SNAP.cards.filter(c => c.stage === 'old-falhou' && c.status !== 'done').length);
  assert.equal(k.comValor.length, 4);
  assert.equal(Math.round(k.tcvSoma * 100) / 100, 1311626.64);
  assert.equal(k.funil.reduce((s, f) => s + f.count, 0), 55);
});

test('famílias de solução não contam A definir e listam cards', () => {
  const k = K.compute(SNAP.cards, SNAP.stages, Date.now());
  const fam = k.familias;
  assert.ok(fam.length > 0);
  assert.ok(!fam.some(f => /definir/i.test(f.label)));
  const star = fam.find(f => /Starlink/.test(f.label));
  assert.ok(star && star.cards.length >= 1);
  assert.equal(k.qualidade.semSolucao.length, SNAP.cards.filter(c => !c.solution || c.solution === 'A definir').length);
  assert.ok(!fam.some(f => /Outras/i.test(f.label)), 'sem balde Outras soluções');
});


test('Britânia: tag atrasado não conta se Prazo (Kanzo) ainda não venceu', () => {
  const now = Date.parse('2026-11-09T15:00:00Z'); // 12:00 America/Sao_Paulo
  const card = {
    id: 49, title: 'BRITANIA', status: 'doing', stage: 'processo-aprovacao-precificacao',
    atrasado: true, // tag herdada do Planner — NÃO é fonte da verdade
    description: [
      '**Datas Planner:** Criado em: 2026-10-29 | Data de conclusão: 2026-10-29 | Data de término: 2026-10-29',
      '**Prazo (Kanzo):** 2026-11-12',
      '**Saúde:** No prazo',
      '**Solução / Escopo:** DIA'
    ].join('\n')
  };
  const f = F.fatos(card.description);
  assert.equal(f.prazo, '2026-11-12', 'prazo efetivo = Kanzo, não Planner');
  assert.equal(F.diasAte(f.prazo, now), 3);
  const k = K.compute([card], [], now);
  const c = k.list[0];
  assert.equal(c.atrasado, false, 'não atrasado: due 12/11 > hoje 09/11');
  assert.equal(k.atrasadosAbertos.length, 0);
});

test('atrasado só pelo prazo efetivo vencido e card aberto', () => {
  const now = Date.parse('2026-11-09T15:00:00Z');
  const vencido = {
    id: 1, title: 'X', status: 'doing', atrasado: false,
    description: '**Prazo (Kanzo):** 2026-11-01\n**Saúde:** Atenção'
  };
  const semPrazo = {
    id: 2, title: 'Y', status: 'doing', atrasado: true,
    description: '**Saúde:** Atenção'
  };
  const feito = {
    id: 3, title: 'Z', status: 'done', atrasado: true,
    description: '**Prazo (Kanzo):** 2026-11-01'
  };
  const k = K.compute([vencido, semPrazo, feito], [], now);
  assert.equal(k.list.find(c => c.id === 1).atrasado, true);
  assert.equal(k.list.find(c => c.id === 2).atrasado, false, 'sem prazo efetivo: tag ignorada');
  assert.equal(k.list.find(c => c.id === 3).atrasado, false, 'concluído não é atrasado');
  assert.equal(k.atrasadosAbertos.length, 1);
});

test('escape de HTML', () => {
  assert.equal(F.esc('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

test('item 2: selo de sync mostra exclusão recusada e a lista do que o Mac recusou', () => {
  const now = Date.parse('2026-11-09T17:00:00Z');
  const base = { mac_online: true, last_seen_at: '2026-11-09T16:59:50Z', last_push_at: '2026-11-09T16:30:00Z', pending_commands: 0 };
  assert.equal(F.resumoSync(base, now).cls, 'live');
  assert.doesNotMatch(F.resumoSync(base, now).txt, /recusad/);
  const r = F.resumoSync(Object.assign({}, base, { refused_deletes: 1, recent_failures: [{ card_id: 8, title: 'Venko', motivo: 'Exclusão recusada pelo Mac: o título do card mudou no Kanzo', at: '2026-11-09T14:26:06Z' }] }), now);
  assert.equal(r.cls, 'off');
  assert.match(r.txt, /Mac online · contato agora · 1 exclusão recusada$/);
  assert.match(r.tip, /• Venko: Exclusão recusada pelo Mac: o título do card mudou no Kanzo \(09\/11\/2026 11:26\)/);
  assert.match(F.resumoSync(Object.assign({}, base, { refused_deletes: 2 }), now).txt, /2 exclusões recusadas/);
  assert.equal(F.resumoSync(Object.assign({}, base, { mac_online: false }), now).cls, 'bad');
  assert.equal(F.resumoSync(null).txt, 'Sync sem dado');
});

test('item 2: aviso no card só quando a API manda sync_warning', () => {
  assert.equal(F.avisoCard({ id: 1 }), null);
  const a = F.avisoCard({ sync_warning: { tipo: 'delete_refused', motivo: 'Exclusão recusada pelo Mac: o título do card mudou no Kanzo', at: '2026-11-09T14:26:06Z' } });
  assert.equal(a.curto, 'exclusão recusada'); assert.equal(a.recusa, true);
  assert.match(a.tip, /continua no Kanzo/);
  assert.equal(F.avisoCard({ sync_warning: { tipo: 'failed', motivo: 'x', at: null } }).curto, 'não aplicado no Mac');
});
