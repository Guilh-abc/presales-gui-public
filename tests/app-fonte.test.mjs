// Remodelo 11/11/2026: o app é a fonte oficial e o Kanzo do Mac foi desligado. Sem MAC_SYNC, nada vai para a fila do Mac,
// tudo grava direto no D1 e /sync/* fica fechado. D1 simulado; nada em produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, sha } from './helpers/harness.mjs';

/* Semeia o quadro com o espelho ligado (como estava até hoje) e depois desliga, como em produção sem a var MAC_SYNC. */
async function appSo() {
  const h = await montar();
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() })).status, 200);
  delete h.env.MAC_SYNC;
  return h;
}
const fila = (h) => h.DATA.db.prepare('SELECT COUNT(*) n FROM pending_commands').get().n;

test('sem MAC_SYNC: /sync/* responde 410 (push antigo do Mac não sobrescreve o D1) e o status diz que o app é a fonte', async () => {
  const h = await appSo();
  for (const [p, m] of [['/sync/push', 'POST'], ['/sync/snapshot', 'POST'], ['/sync/pull', 'GET'], ['/sync/ack', 'POST']]) {
    const r = await h.call(p, { method: m, as: 'sync', body: m === 'POST' ? board() : undefined });
    assert.equal(r.status, 410, p); assert.equal(r.body.error, 'sync_desligado');
  }
  assert.equal((await h.call('/api/saude')).body.app_only, true);
  const st = (await h.call('/api/sync/status')).body;
  assert.equal(st.app_only, true); assert.match(st.message, /app é a fonte oficial/);
});

test('criar, editar, comentar e excluir gravam direto no D1, sem fila e sem marca de pendente', async () => {
  const h = await appSo();
  const max = h.DATA.db.prepare('SELECT MAX(id) m FROM cards').get().m;
  const c = await h.call('/api/cards', { method: 'POST', body: { title: 'Wabtec teste', stage: 'precificacao', description: '**Situação atual:** Cliente não assinou na época.' } });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.id, max + 1, 'id definitivo na hora (sem id temporário 100000+)');
  assert.equal(c.body.pending, false); assert.equal(c.body.pending_command_id, null); assert.equal(c.body.app_only, true);
  const p = await h.call('/api/cards/' + c.body.id, { method: 'PATCH', body: { stage: 'apresentacao-executiva', status: 'doing', expect_description_sha256: sha(c.body.description) } });
  assert.equal(p.status, 200, p.text); assert.equal(p.body.stage, 'apresentacao-executiva'); assert.equal(p.body.pending, false);
  const cm = await h.call('/api/cards/' + c.body.id + '/comments', { method: 'POST', body: { body: 'Proposta enviada.' } });
  assert.equal(cm.status, 200); assert.equal(cm.body.pending, false);
  assert.equal((await h.call('/api/cards/' + c.body.id)).body.comments.length, 1);
  assert.equal(fila(h), 0, 'nada na fila do Mac');
  const lista = (await h.call('/api/cards')).body.cards;
  assert.ok(lista.some(x => x.id === c.body.id && x.title === 'Wabtec teste'), 'card novo continua na lista (não some como o Wabtec)');
  assert.ok(lista.every(x => x.pending === false && x.sync_warning === null));
  const sh = h.DATA.db.prepare("SELECT source, to_stage FROM stage_history WHERE card_id = ? ORDER BY id").all(c.body.id).map(r => r.source + ':' + r.to_stage);
  assert.deepEqual(sh, ['criacao:precificacao', 'painel:apresentacao-executiva']);
  const d = await h.call('/api/cards/' + c.body.id, { method: 'DELETE' });
  assert.equal(d.status, 200); assert.equal(fila(h), 0);
  assert.ok(!(await h.call('/api/cards')).body.cards.some(x => x.id === c.body.id));
});

test('marcas antigas de "aguardando o Mac" no D1 não aparecem mais', async () => {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  const a = (await h.call('/api/cards/44')).body;
  await h.call('/api/cards/44', { method: 'PATCH', body: { title: 'X', expect_description_sha256: sha(a.description) } });
  assert.equal((await h.call('/api/cards/44')).body.pending, true, 'com o Mac ligado ficava pendente');
  delete h.env.MAC_SYNC;
  assert.equal((await h.call('/api/cards/44')).body.pending, false);
});

test('registro rápido grava direto no app e o desfazer volta o card (se ninguém mexeu depois)', async () => {
  const h = await appSo();
  const antes = (await h.call('/api/cards/46')).body;
  const r = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 46, raw: 'mandei proposta', comentario: 'mandei proposta', stage: 'apresentacao-executiva' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.app_only, true); assert.deepEqual(r.body.pending_command_ids, []);
  assert.equal(fila(h), 0);
  assert.equal((await h.call('/api/cards/46')).body.stage, 'apresentacao-executiva');
  let hist = (await h.call('/api/rapido/history')).body.history;
  assert.equal(hist[0].status, 'applied'); assert.equal(hist[0].pode_desfazer, true);
  const u = await h.call('/api/rapido/' + r.body.id + '/undo', { method: 'POST', body: {} });
  assert.equal(u.status, 200, u.text);
  const depois = (await h.call('/api/cards/46')).body;
  assert.equal(depois.stage, antes.stage); assert.equal(depois.comments.length, antes.comments.length);
  hist = (await h.call('/api/rapido/history')).body.history;
  assert.equal(hist[0].status, 'cancelled'); assert.equal(hist[0].pode_desfazer, false);
  // editado depois → 409
  const r2 = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 46, raw: 'x', comentario: 'x', stage: 'fechamento' } });
  const c46 = (await h.call('/api/cards/46')).body;
  await h.call('/api/cards/46', { method: 'PATCH', body: { title: 'mudou', expect_description_sha256: sha(c46.description) } });
  const u2 = await h.call('/api/rapido/' + r2.body.id + '/undo', { method: 'POST', body: {} });
  assert.equal(u2.status, 409); assert.equal(u2.body.error, 'editado_depois');
});

test('banco sem projeto (app novo): criar card cria o projeto pre-vendas em vez de esperar o Mac', async () => {
  const h = await montar(); delete h.env.MAC_SYNC;
  const c = await h.call('/api/cards', { method: 'POST', body: { title: 'Primeiro' } });
  assert.equal(c.status, 200, c.text); assert.equal(c.body.key, 'pre-vendas#1');
});
