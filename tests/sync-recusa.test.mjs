// Item 2: exclusão recusada pelo Mac (delete_guard) fica visível no card e no selo de sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, congelarRelogio, sha } from './helpers/harness.mjs';

async function pronto() { const h = await montar(); await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() }); return h; }
const ack = (h, cmds, results) => h.call('/sync/ack', { method: 'POST', as: 'sync', body: { ids: cmds.map(c => c.id), results } });

test('delete recusado: comando failed com motivo, card volta ao espelho na hora, aviso no card e no status', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    assert.equal((await h.call('/api/cards/8', { method: 'DELETE' })).status, 200);
    assert.equal((await h.call('/api/cards/8')).body.deleted_at != null, true, 'some do espelho até o Mac responder');
    const cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
    assert.equal(cmds.length, 1); assert.equal(cmds[0].op, 'delete_task'); assert.ok(cmds[0].payload.expected_title);
    // formato exato que o agente do Mac envia hoje (presales_sync_agent.py)
    const r = await ack(h, cmds, [{ ok: false, op: 'delete_task', error: "title mismatch: expected 'x' got 'Verificacao de novo fornecedor para substituir Venko'", refused: true }]);
    assert.equal(r.body.failed, 1);
    const row = h.DATA.db.prepare('SELECT status, result_json FROM pending_commands WHERE id = ?').get(cmds[0].id);
    assert.equal(row.status, 'failed');
    assert.equal(JSON.parse(row.result_json).motivo, 'Exclusão recusada pelo Mac: o título do card mudou no Kanzo');
    const card = (await h.call('/api/cards/8')).body;
    assert.equal(card.deleted_at, null, 'card reaparece sem esperar o próximo push');
    assert.equal(card.sync_warning.tipo, 'delete_refused');
    assert.match(card.sync_warning.motivo, /^Exclusão recusada pelo Mac/);
    const lista = (await h.call('/api/cards')).body.cards.find(c => c.id === 8);
    assert.equal(lista.sync_warning.tipo, 'delete_refused');
    const st = (await h.call('/api/sync/status')).body;
    assert.equal(st.refused_deletes, 1); assert.equal(st.pending_commands, 0);
    assert.equal(st.recent_failures[0].card_id, 8); assert.ok(st.recent_failures[0].title);
    const hist = (await h.call('/api/cards/8/audit')).body;
    assert.equal(hist.events[0].action, 'sync_refused'); assert.match(hist.commands[0].motivo, /recusada/);
  } finally { volta(); }
});

test('hash da descrição mudou e card inexistente têm motivos próprios; ack repetido não duplica', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    await h.call('/api/cards/9', { method: 'DELETE' });
    await h.call('/api/cards/10', { method: 'DELETE' });
    const cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
    const res = [{ ok: false, op: 'delete_task', error: 'description hash mismatch', refused: true }, { ok: false, op: 'delete_task', error: "{'content': [{'type': 'text', 'text': 'no task #10'}], 'isError': True}" }];
    assert.equal((await ack(h, cmds, res)).body.failed, 2);
    assert.equal((await ack(h, cmds, res)).body.failed, 0, 'segundo ack do mesmo comando é ignorado');
    const c9 = (await h.call('/api/cards/9')).body, c10 = (await h.call('/api/cards/10')).body;
    assert.equal(c9.sync_warning.motivo, 'Exclusão recusada pelo Mac: a descrição do card mudou no Kanzo');
    assert.equal(c9.deleted_at, null);
    assert.equal(c10.sync_warning.tipo, 'failed'); assert.match(c10.sync_warning.motivo, /não existe mais no Mac/);
    assert.notEqual(c10.deleted_at, null, 'não existe no Mac: continua fora do espelho');
    assert.equal((await h.call('/api/sync/status')).body.refused_deletes, 1, 'selo conta só recusas de cards que existem');
  } finally { volta(); }
});

test('edição recusada por conflito vira aviso "failed" e some quando a próxima edição é aplicada', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    const c = (await h.call('/api/cards/11')).body;
    await h.call('/api/cards/11', { method: 'PATCH', body: { description: c.description + '\nx', expect_description_sha256: sha(c.description) } });
    let cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
    await ack(h, cmds, [{ ok: false, op: 'update_task', error: 'conflito: a descrição mudou no Kanzo depois da leitura do painel' }]);
    let w = (await h.call('/api/cards/11')).body.sync_warning;
    assert.equal(w.tipo, 'failed'); assert.equal(w.motivo, 'Edição recusada pelo Mac: a descrição do card mudou no Kanzo');
    const c2 = (await h.call('/api/cards/11')).body;
    await h.call('/api/cards/11', { method: 'PATCH', body: { title: c2.title + ' (ok)' } });
    cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
    await ack(h, cmds, [{ ok: true, op: 'update_task' }]);
    assert.equal((await h.call('/api/cards/11')).body.sync_warning, null);
    assert.equal((await h.call('/api/sync/status')).body.recent_failures.length, 0);
  } finally { volta(); }
});

test('falha com mais de 7 dias não aparece', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    h.DATA.db.prepare("INSERT INTO pending_commands (created_at, status, op, entity, entity_id, payload_json, result_json, applied_at) VALUES ('2026-10-01T00:00:00Z','failed','delete_task','card','12','{}','{\"ok\":false,\"error\":\"title mismatch\",\"refused\":true}','2026-10-01T00:00:10Z')").run();
    assert.equal((await h.call('/api/cards/12')).body.sync_warning, null);
    assert.equal((await h.call('/api/sync/status')).body.refused_deletes, 0);
  } finally { volta(); }
});

test('motivoFalha cobre os erros reais do agente do Mac', async () => {
  await import('../public/js/kanzo-core.js');
  const M = globalThis.KanzoCore.motivoFalha;
  assert.deepEqual(M('delete_task', 'missing expected_title (refusing blind delete)'), { recusado: true, motivo: 'Exclusão recusada pelo Mac: pedido sem dados de conferência (título/descrição)' });
  assert.equal(M('delete_task', 'card not found on Mac').recusado, false);
  assert.match(M('add_comment', 'boom').motivo, /^Comentário falhou no Mac: boom$/);
  assert.match(M('x', null).motivo, /^Comando falhou no Mac$/);
});
