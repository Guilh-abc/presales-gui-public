// 12/11/2026: chave de API do OpenCode (src/apikey.js). D1 simulado; nada em produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, sha } from './helpers/harness.mjs';

async function app() {
  const h = await montar();
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() })).status, 200);
  delete h.env.MAC_SYNC;
  const k = await h.call('/api/admin/api-keys', { method: 'POST', body: { nome: 'OpenCode Mac' } });
  assert.equal(k.status, 200); assert.match(k.body.chave, /^kzo_[A-Za-z0-9_-]{43}$/);
  const ag = (path, o = {}) => h.call(path, { ...o, as: 'anon', headers: { Authorization: 'Bearer ' + k.body.chave, 'Content-Type': 'application/json', ...(o.headers || {}) } });
  return { h, ag, key: k.body };
}
const SENS = /custo|margem|\bnet\b|\bgross\b|pricing interno/i;

test('chave: guardada só como hash; viewer não cria; inválida/revogada = 401; Bearer ignora o cookie', async () => {
  const { h, ag, key } = await app();
  const row = h.DATA.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(key.id);
  assert.equal(row.hash, sha(key.chave)); assert.ok(!JSON.stringify(row).includes(key.chave));
  assert.equal((await h.call('/api/admin/api-keys', { method: 'POST', as: 'viewer', body: {} })).status, 403);
  assert.equal((await h.call('/api/admin/api-keys', { method: 'POST', body: {}, headers: { Origin: 'https://mal.test' } })).status, 403);
  assert.equal((await h.call('/api/admin/api-keys')).body.keys.length, 1);
  assert.equal((await ag('/api/agent/whoami')).status, 200);
  const bad = await h.call('/api/cards', { as: 'admin', headers: { Authorization: 'Bearer kzo_' + 'x'.repeat(43) } });
  assert.equal(bad.status, 401); assert.equal(bad.body.error, 'invalid_key'); // cookie de admin presente, mas o Bearer manda
  assert.equal((await h.call('/api/cards', { as: 'anon', headers: { Authorization: 'Bearer lixo' } })).status, 401);
  assert.equal((await h.call('/api/admin/api-keys/' + key.id + '/revoke', { method: 'POST', body: {} })).status, 200);
  const rv = await ag('/api/cards'); assert.equal(rv.status, 401); assert.equal(rv.body.error, 'revoked');
});

test('leitura: cards, card, tarefas e histórico sem custo/margem; campos estruturados', async () => {
  const { h, ag } = await app();
  const adm = (await h.call('/api/cards')).body.cards, vw = (await h.call('/api/cards', { as: 'viewer' })).body.cards;
  const alvo = adm.find(c => vw.find(v => v.id === c.id).description !== c.description);
  assert.ok(alvo, 'precisa de um card com custo no snapshot');
  const l = await ag('/api/cards'); assert.equal(l.status, 200); assert.equal(l.body.cards.length, adm.length);
  const c = await ag('/api/cards/' + alvo.id); assert.equal(c.status, 200);
  assert.notEqual(c.body.description, alvo.description); assert.match(c.body.description, /omitido/);
  assert.ok(c.body.campos && 'situacao' in c.body.campos && 'proxima' in c.body.campos);
  assert.equal((await ag('/api/cards/' + alvo.id + '/tasks')).status, 200);
  assert.equal((await ag('/api/tasks')).body.sugestoes, undefined);
  assert.equal((await ag('/api/cards/' + alvo.id + '/audit')).status, 200);
  // admin, rascunho de pricing, summary, alertas, sync e páginas ficam fora
  for (const p of ['/api/admin/users', '/api/admin/api-keys', '/api/cards/' + alvo.id + '/rascunho', '/api/summary', '/api/alertas', '/api/relatorio', '/api/me', '/', '/admin', '/js/dados-kanzo.js'])
    assert.equal((await ag(p)).status, 403, p);
});

test('escrita: cria card, edita campos, tarefa, conclui, comenta — tudo no histórico como "via OpenCode"', async () => {
  const { h, ag } = await app();
  const n = await ag('/api/cards', { method: 'POST', body: { title: 'Teste OpenCode', stage: 'recebimento-do-projeto', solucao: 'Starlink / Satélite', responsaveis: ['Guilherme'], situacao: 'Recebido o pedido.', proxima: 'Agendar discovery.' } });
  assert.equal(n.status, 200, n.text); const id = n.body.card.id;
  assert.equal(n.body.card.stage, 'recebimento-do-projeto'); assert.equal(n.body.card.campos.situacao, 'Recebido o pedido.');
  assert.equal(n.body.card.solution, 'Starlink / Satélite');
  const e = await ag('/api/cards/' + id, { method: 'PATCH', body: { stage: 'precificacao', status: 'doing', saude: 'Atenção', prazo: '30/11/2026', situacao: 'Cotação pedida.', proxima: 'Cobrar Ingram.', responsaveis: 'Guilherme, Arthur' } });
  assert.equal(e.status, 200, e.text);
  assert.deepEqual([e.body.card.stage, e.body.card.status, e.body.card.campos.saude, e.body.card.campos.prazo, e.body.card.campos.proxima], ['precificacao', 'doing', 'Atenção', '2026-11-30', 'Cobrar Ingram.']);
  assert.deepEqual(e.body.card.campos.responsaveis, ['Guilherme', 'Arthur']);
  const t = await ag('/api/cards/' + id + '/tasks', { method: 'POST', body: { title: 'Pedir cotação', due_date: '2026-11-20' } });
  assert.equal(t.status, 200, t.text); assert.equal(t.body.created_by, 'via OpenCode');
  const t2 = await ag('/api/tasks/' + t.body.id, { method: 'PATCH', body: { due_date: '2026-11-21' } }); assert.equal(t2.status, 200);
  const d = await ag('/api/tasks/' + t.body.id, { method: 'PATCH', body: { done: true } }); assert.equal(d.status, 200); assert.equal(d.body.done, true);
  const cm = await ag('/api/cards/' + id + '/comments', { method: 'POST', body: { body: 'Registrado pelo OpenCode.', author: 'Outro' } });
  assert.equal(cm.status, 200); assert.equal(cm.body.author, 'via OpenCode');
  const hist = (await h.call('/api/cards/' + id + '/audit')).body.events;
  assert.ok(hist.length >= 6); assert.ok(hist.every(x => x.by === 'via OpenCode'), JSON.stringify(hist.map(x => x.by)));
  assert.ok(hist.some(x => /^Tarefa concluída: Pedir cotação/.test(x.action)));
  assert.ok(hist.some(x => x.action === 'update' && x.changes.some(c => c.campo === 'Próxima ação')));
  assert.equal(h.DATA.db.prepare('SELECT COUNT(*) n FROM pending_commands').get().n, 0);
});

test('edição preserva a parte de custo/margem que o agente não vê', async () => {
  const { h, ag } = await app();
  const adm = (await h.call('/api/cards')).body.cards, vw = (await h.call('/api/cards', { as: 'viewer' })).body.cards;
  const antes = adm.find(c => vw.find(v => v.id === c.id).description !== c.description);
  assert.ok(antes);
  const r = await ag('/api/cards/' + antes.id, { method: 'PATCH', body: { proxima: 'Revisar proposta com o Guilherme.' } });
  assert.equal(r.status, 200, r.text);
  const depois = (await h.call('/api/cards/' + antes.id)).body.description;
  const sem = (d) => d.split('\n').filter(l => !/^\*\*Pr[oó]xima a[cç][aã]o/.test(l)).join('\n').replace(/^\n+/, '');
  assert.equal(sem(depois), sem(antes.description)); // a parte oculta (custo/margem) continua intacta
  assert.ok(!r.body.card.description.includes(antes.description.split('\n').find(l => vw.find(v => v.id === antes.id).description.indexOf(l) < 0) || '§§'));
  assert.match(depois, /Revisar proposta com o Guilherme\./);
  assert.ok(!SENS.test(r.body.card.description) || /omitido/.test(r.body.card.description));
});

test('negações: excluir, custo/margem, valores, descrição livre, fechamento sem confirmar, campos inválidos', async () => {
  const { h, ag } = await app();
  const c = (await h.call('/api/cards')).body.cards.find(x => x.status !== 'done' && !['ganho-handoff', 'old-falhou'].includes(x.stage));
  const tk = await ag('/api/cards/' + c.id + '/tasks', { method: 'POST', body: { title: 'x tarefa' } });
  for (const p of ['/api/cards/' + c.id, '/api/tasks/' + tk.body.id]) { const r = await ag(p, { method: 'DELETE' }); assert.equal(r.status, 403); assert.equal(r.body.error, 'delete_nao_permitido'); }
  assert.ok((await h.call('/api/cards/' + c.id)).body.active);
  const casos = [
    ['PATCH', '/api/cards/' + c.id, { tcv: 100000 }, 403, 'custo_margem'],
    ['PATCH', '/api/cards/' + c.id, { margem: '30%' }, 403, 'custo_margem'],
    ['PATCH', '/api/cards/' + c.id, { situacao: 'Custo Ingram R$ 12.000, margem 18%' }, 403, 'custo_margem'],
    ['PATCH', '/api/cards/' + c.id, { description: 'tudo novo' }, 403, 'campo_nao_permitido'],
    ['PATCH', '/api/cards/' + c.id, { title: 'novo' }, 403, 'campo_nao_permitido'],
    ['PATCH', '/api/cards/' + c.id, { stage: 'ganho-handoff' }, 409, 'confirmar'],
    ['PATCH', '/api/cards/' + c.id, { status: 'done' }, 409, 'confirmar'],
    ['PATCH', '/api/cards/' + c.id, { stage: 'inventada' }, 400, 'validacao'],
    ['PATCH', '/api/cards/' + c.id, { saude: 'Ótimo' }, 400, 'validacao'],
    ['PATCH', '/api/cards/' + c.id, { prazo: '31/02/2026' }, 400, 'validacao'],
    ['POST', '/api/cards', { title: 'Card', description: '## Pricing interno\nCusto R$ 10' }, 403, 'custo_margem'],
    ['POST', '/api/cards', { title: 'Card', values: { tcv: 1 } }, 403, 'custo_margem'],
    ['POST', '/api/cards/' + c.id + '/comments', { body: 'GM 22% e net R$ 50 mil' }, 403, 'custo_margem'],
    ['POST', '/api/cards/' + c.id + '/tasks', { title: 'Cobrar margem de 20%' }, 403, 'custo_margem'],
    ['POST', '/api/cards/' + c.id + '/tasks', { source: 'suggestion', sugg_key: 'x' }, 403, 'campo_nao_permitido'],
    ['PATCH', '/api/tasks/' + tk.body.id, { dismissed: true }, 403, 'campo_nao_permitido'],
    ['POST', '/api/rapido/confirm', { card_id: c.id }, 403, 'fora_do_escopo'],
    ['POST', '/api/admin/api-keys', {}, 403, 'fora_do_escopo'],
    ['POST', '/sync/push', {}, 410, 'sync_desligado']
  ];
  for (const [m, p, b, st, code] of casos) { const r = await ag(p, { method: m, body: b }); assert.equal(r.status, st, m + ' ' + p + ' ' + JSON.stringify(b) + ' → ' + r.text); assert.equal(r.body.error, code, p); }
  const ok = await ag('/api/cards/' + c.id, { method: 'PATCH', body: { stage: 'ganho-handoff', confirmar: true } }); assert.equal(ok.status, 200, ok.text);
});

test('limite: N pedidos por minuto por chave; chave inválida bloqueia o IP após 20 tentativas', async () => {
  const { h, ag } = await app();
  h.env.API_RATE_MAX = '5';
  for (let i = 0; i < 5; i++) assert.equal((await ag('/api/stages')).status, 200);
  const r = await ag('/api/stages'); assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_limit');
  for (let i = 0; i < 20; i++) assert.equal((await h.call('/api/cards', { as: 'anon', headers: { Authorization: 'Bearer kzo_' + 'y'.repeat(43) } })).status, 401);
  assert.equal((await h.call('/api/cards', { as: 'anon', headers: { Authorization: 'Bearer kzo_' + 'y'.repeat(43) } })).status, 429);
});
