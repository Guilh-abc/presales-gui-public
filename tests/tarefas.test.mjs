// Remodelo 11/11/2026: tarefas dentro do card (migração 7, card_tasks). D1 simulado; nada em produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board } from './helpers/harness.mjs';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/migrations.js';
import '../public/js/kanzo-core.js';
const KC = globalThis.KanzoCore;

async function pronto() {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  delete h.env.MAC_SYNC; // produção: app como fonte oficial
  return h;
}

test('migração 7 = card_tasks, sem reusar id; nada de backup_runs/checklist do Lote 4 ou Kiro', async () => {
  assert.equal(SCHEMA_VERSION, 10); // 12/11: 8 = alertas; 9 = chave do OpenCode (api_keys); 18/11: 10 = documentos e links do card; só adicionam
  const m7 = MIGRATIONS.find(m => m.id === 7);
  assert.match(m7.sql[0], /CREATE TABLE IF NOT EXISTS card_tasks/);
  assert.doesNotMatch(JSON.stringify(MIGRATIONS), /backup_runs|checklist_defs|report_cache|card_outcomes/);
  const h = await montar({ semSchema: true });
  const cols = h.DATA.db.prepare('PRAGMA table_info(card_tasks)').all().map(c => c.name);
  for (const c of ['id', 'card_id', 'title', 'due_date', 'done', 'done_at', 'source', 'sugg_key', 'stage', 'dismissed', 'created_at', 'updated_at', 'deleted_at']) assert.ok(cols.includes(c), c);
  // banco no schema 6 sobe a 7 e 8 (8 = alertas, 12/11)
  h.DATA.exec("UPDATE meta SET value = '6' WHERE key = 'schema_version'"); h.DATA.exec('DROP TABLE card_tasks');
  const { migrar } = await import('../src/migrations.js');
  assert.deepEqual(await migrar(h.env), [7, 8, 9, 10]); // 9 = api_keys do OpenCode (12/11); 10 = documentos (18/11)
});

test('admin cria, edita, conclui, desmarca e exclui tarefa livre; viewer só lê', async () => {
  const h = await pronto();
  const c = await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: '  Ligar para o cliente  ', due_date: '2026-11-12' } });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.title, 'Ligar para o cliente'); assert.equal(c.body.due_date, '2026-11-12'); assert.equal(c.body.source, 'user'); assert.equal(c.body.done, false);
  const id = c.body.id;
  let r = await h.call('/api/tasks/' + id, { method: 'PATCH', body: { done: true } });
  assert.equal(r.body.done, true); assert.ok(r.body.done_at);
  r = await h.call('/api/tasks/' + id, { method: 'PATCH', body: { done: false, title: 'Ligar e confirmar', due_date: '' } });
  assert.equal(r.body.done, false); assert.equal(r.body.done_at, null); assert.equal(r.body.title, 'Ligar e confirmar'); assert.equal(r.body.due_date, null);
  // viewer: lê, não escreve
  const v = await h.call('/api/tasks', { as: 'viewer' });
  assert.equal(v.status, 200); assert.equal(v.body.tasks.length, 1); assert.equal(v.body.sugestoes, undefined);
  assert.equal((await h.call('/api/cards/46/tasks', { as: 'viewer' })).body.tasks.length, 1);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', as: 'viewer', body: { title: 'x' } })).status, 403);
  assert.equal((await h.call('/api/tasks/' + id, { method: 'PATCH', as: 'viewer', body: { done: true } })).status, 403);
  assert.equal((await h.call('/api/tasks/' + id, { method: 'DELETE', as: 'viewer' })).status, 403);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', headers: { 'X-MCO': '' }, body: { title: 'x' } })).status, 403, 'sem X-MCO');
  assert.equal((await h.call('/api/tasks', { as: 'anon' })).status, 401);
  // excluir
  assert.equal((await h.call('/api/tasks/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await h.call('/api/tasks')).body.tasks.length, 0);
  assert.equal((await h.call('/api/tasks/' + id, { method: 'DELETE' })).status, 404);
  assert.equal(h.DATA.db.prepare('SELECT COUNT(*) n FROM pending_commands').get().n, 0, 'nada para o Mac');
  assert.ok(h.DATA.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity = 'task'").get().n >= 4, 'auditado');
});

test('validação: título vazio, prazo inválido, card inexistente, dispensar tarefa livre', async () => {
  const h = await pronto();
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: '   ' } })).status, 400);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'x', due_date: '2026-02-30' } })).status, 400);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'x', due_date: '12/11/2026' } })).status, 400);
  assert.equal((await h.call('/api/cards/999999/tasks', { method: 'POST', body: { title: 'x' } })).status, 404);
  const t = (await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'x'.repeat(500) } })).body;
  assert.equal(t.title.length, 200);
  assert.equal((await h.call('/api/tasks/' + t.id, { method: 'PATCH', body: { dismissed: true } })).status, 400);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', body: { source: 'suggestion', sugg_key: 'inventada' } })).status, 400);
});

test('sugestões da etapa: feita/dispensada viram linha única por card; texto vem do seed; card removido some da lista', async () => {
  const h = await pronto();
  const r1 = await h.call('/api/cards/46/tasks', { method: 'POST', body: { source: 'suggestion', sugg_key: 'proposta-enviada', done: true, title: 'ignorado' } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.title, 'Proposta enviada ao cliente'); assert.equal(r1.body.stage, 'apresentacao-executiva'); assert.equal(r1.body.done, true);
  const r2 = await h.call('/api/cards/46/tasks', { method: 'POST', body: { source: 'suggestion', sugg_key: 'proposta-enviada', dismissed: true } });
  assert.equal(r2.body.id, r1.body.id, 'idempotente: mesma linha'); assert.equal(r2.body.dismissed, true); assert.equal(r2.body.done, false);
  assert.equal((await h.call('/api/tasks/' + r1.body.id, { method: 'PATCH', body: { title: 'outro texto' } })).status, 400, 'texto do seed não muda');
  const adm = (await h.call('/api/tasks')).body;
  assert.equal(adm.tasks.length, 1); assert.ok(adm.sugestoes['precificacao']);
  assert.equal((await h.call('/api/tasks', { as: 'viewer' })).body.tasks.length, 0, 'dispensada não aparece para leitura');
  // excluída e re-adicionada: reaproveita a linha
  await h.call('/api/tasks/' + r1.body.id, { method: 'DELETE' });
  const r3 = await h.call('/api/cards/46/tasks', { method: 'POST', body: { source: 'suggestion', sugg_key: 'proposta-enviada' } });
  assert.equal(r3.body.id, r1.body.id); assert.equal(r3.body.dismissed, false);
  // card removido: as tarefas dele saem da lista
  await h.call('/api/cards/46', { method: 'DELETE' });
  assert.equal((await h.call('/api/tasks')).body.tasks.length, 0);
  assert.equal((await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'x' } })).status, 404);
});

test('seed: sugestões por etapa (Starlink só para SATELLITE) e perfil leitura sem custo/margem no título', async () => {
  assert.deepEqual(KC.sugestoesDaEtapa('processo-de-cotacao', '').map(s => s.title), ['Cotação solicitada ao fornecedor', 'Cotação recebida']);
  assert.deepEqual(KC.sugestoesDaEtapa('precificacao', 'DIA').map(s => s.key), ['pricing-montado']);
  assert.deepEqual(KC.sugestoesDaEtapa('precificacao', 'SATELLITE / Starlink').map(s => s.key), ['pricing-montado', 'pricing-starlink']);
  assert.deepEqual(KC.sugestoesDaEtapa('processo-aprovacao-precificacao', '').map(s => s.title), ['Pricing aprovado']);
  assert.deepEqual(KC.sugestoesDaEtapa('apresentacao-executiva', '').map(s => [s.key, s.opcional]), [['proposta-enviada', false], ['feedback-registrado', true]]);
  assert.deepEqual(KC.sugestoesDaEtapa('hold', ''), []);
  const h = await pronto();
  await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'Rever margem 32% do pricing' } });
  const adm = (await h.call('/api/tasks')).body.tasks[0], vw = (await h.call('/api/tasks', { as: 'viewer' })).body.tasks[0];
  assert.match(adm.title, /margem 32%/);
  assert.doesNotMatch(vw.title, /margem|32/); assert.equal(vw.created_by, null);
});
