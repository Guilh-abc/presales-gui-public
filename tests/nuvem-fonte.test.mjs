// Migração nuvem lote 1 — D1 fonte oficial; Mac espelho. Mac simulado; nada no D1 real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, sha } from './helpers/harness.mjs';

const tarefa = (b, id) => b.projects[0].tasks.find(t => t.id === id);
const comStage = (t, st) => { t.tags = t.tags.split(',').filter(x => x && !x.startsWith('stage:')).concat('stage:' + st).join(','); };
async function push(h, b) {
  const r = await h.call('/sync/push', { method: 'POST', as: 'sync', body: b });
  assert.equal(r.status, 200, r.text);
  return r;
}

test('(a) painel/rápido grava no D1 na hora, enfileira para o Mac e registra stage_history', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  const antes = (await h.call('/api/cards/44')).body;
  const r = await h.call('/api/cards/44', { method: 'PATCH', body: { stage: 'fechamento', expect_description_sha256: sha(antes.description) } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.stage, 'fechamento');
  assert.ok(r.body.pending_command_id);
  const cw = h.DATA.db.prepare('SELECT kind FROM cloud_writes WHERE card_id = 44').get();
  assert.equal(cw.kind, 'update');
  const sh = h.DATA.db.prepare("SELECT source, to_stage FROM stage_history WHERE card_id = 44 AND source != 'inicio' ORDER BY id DESC LIMIT 1").get();
  assert.equal(sh.source, 'painel'); assert.equal(sh.to_stage, 'fechamento');
  const pend = h.DATA.db.prepare("SELECT op, status FROM pending_commands WHERE id = ?").get(r.body.pending_command_id);
  assert.equal(pend.op, 'update_task'); assert.equal(pend.status, 'pending');
});

test('(b) push/snapshot do Mac não desfaz mudança da nuvem; conflito registrado; create na nuvem sobrevive', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  const c44 = (await h.call('/api/cards/44')).body;
  await h.call('/api/cards/44', { method: 'PATCH', body: { title: 'TITULO NUVEM', expect_description_sha256: sha(c44.description) } });
  // Mac ainda tem título antigo
  const r = await push(h, b);
  assert.equal((await h.call('/api/cards/44')).body.title, 'TITULO NUVEM');
  assert.ok(r.body.conflicts >= 1);
  const conf = h.DATA.db.prepare('SELECT resolution, kind FROM sync_conflicts WHERE card_id = 44 ORDER BY id DESC LIMIT 1').get();
  assert.equal(conf.resolution, 'cloud_wins');

  // create na nuvem
  const cr = await h.call('/api/cards', { method: 'POST', body: { title: 'SO SO NUVEM', stage: 'recebimento-do-projeto' } });
  assert.equal(cr.status, 200, cr.text);
  const tempId = cr.body.id;
  assert.ok(tempId >= 100000);
  const nAntes = (await h.call('/api/cards')).body.cards.filter(c => !c.deleted_at).length;
  await push(h, b); // Mac sem o card novo
  const cards = (await h.call('/api/cards')).body.cards;
  assert.ok(cards.some(c => c.id === tempId && c.title === 'SO SO NUVEM'), 'create na nuvem permanece');
  assert.ok(cards.length >= nAntes - 0);

  // mudança só do Mac (card sem cloud_write) ainda aplica
  const t2 = tarefa(b, 2);
  t2.title = 'SO SO MAC';
  // limpa proteção se houver
  h.DATA.db.prepare('DELETE FROM cloud_writes WHERE card_id = 2').run();
  h.DATA.db.prepare("DELETE FROM pending_commands WHERE entity_id = '2' AND status = 'pending'").run();
  await push(h, b);
  assert.equal((await h.call('/api/cards/2')).body.title, 'SO SO MAC');
});

test('(c) resposta do push compatível com o agente (campos obrigatórios)', async () => {
  const h = await montar(); const b = board();
  const r = await push(h, b);
  for (const k of ['ok', 'synced_at', 'cards', 'comments', 'pending_reapplied']) assert.equal(k in r.body, true, k);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.cards, 55);
  const snap = await h.call('/sync/snapshot', { method: 'POST', as: 'sync', body: Object.assign({}, b, { snapshot: true }) });
  assert.equal(snap.status, 200);
  for (const k of ['ok', 'synced_at', 'cards', 'comments', 'pending_reapplied']) assert.ok(k in snap.body, k);
  const st = (await h.call('/api/sync/status')).body;
  assert.equal(st.source_of_truth, 'd1');
  assert.equal(typeof st.mac_online, 'boolean');
});
