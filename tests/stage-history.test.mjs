// Item 1 — histórico de etapa (stage_history, migração 5). Mac simulado; nada no D1 real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, sha } from './helpers/harness.mjs';

const rows = (h) => h.DATA.db.prepare('SELECT card_id, from_stage, to_stage, changed_at, source, command_id FROM stage_history ORDER BY id').all();
const tarefa = (b, id) => b.projects[0].tasks.find(t => t.id === id);
const comStage = (t, st) => { t.tags = t.tags.split(',').filter(x => x && !x.startsWith('stage:')).concat('stage:' + st).join(','); };
async function push(h, b) { const r = await h.call('/sync/push', { method: 'POST', as: 'sync', body: b }); assert.equal(r.status, 200, r.text); return r; }

test('1º push: só observação inicial ("inicio") para cada card; tempo na etapa = sem dado; 2º push igual não grava nada', async () => {
  const h = await montar(); const b = board();
  await push(h, b);
  const r1 = rows(h); assert.equal(r1.length, 55); assert.ok(r1.every(x => x.source === 'inicio' && x.from_stage === null));
  await push(h, b); assert.equal(rows(h).length, 55, 'idempotente');
  const api = (await h.call('/api/stage-history', { as: 'viewer' })).body;
  assert.equal(api.cards.length, 55); assert.ok(api.cards.every(c => c.dias_na_etapa === null && c.na_etapa_desde === null), 'sem mudança registrada = sem dado');
  assert.ok(api.registro_desde); assert.equal(api.parados.length, 0);
});

test('mudança feita no Kanzo (push com outra etapa) grava "kanzo" com de/para; tempo na etapa conta dessa hora', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  const t = tarefa(b, 44), antes = t.tags.split(',').find(x => x.startsWith('stage:')).slice(6);
  comStage(t, 'fechamento'); await push(h, b);
  const novas = rows(h).filter(x => x.source !== 'inicio');
  assert.equal(novas.length, 1); assert.equal(novas[0].card_id, 44); assert.equal(novas[0].from_stage, antes); assert.equal(novas[0].to_stage, 'fechamento'); assert.equal(novas[0].source, 'kanzo');
  const c = (await h.call('/api/stage-history?card_id=44', { as: 'viewer' })).body;
  const k = c.cards.find(x => x.card_id === 44); assert.equal(k.dias_na_etapa, 0); assert.equal(k.origem, 'kanzo');
  assert.equal(c.historico.length, 2);
});

test('mudança pelo painel: grava stage_history na hora (origem painel); push do Mac com etapa antiga não desfaz (nuvem vence)', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  const antes = (await h.call('/api/cards/44')).body;
  const r = await h.call('/api/cards/44', { method: 'PATCH', body: { stage: 'fechamento', expect_description_sha256: sha(antes.description) } });
  assert.equal(r.status, 200, r.text);
  const n0 = rows(h).filter(x => x.source !== 'inicio');
  assert.equal(n0.length, 1); assert.equal(n0[0].source, 'painel'); assert.equal(n0[0].to_stage, 'fechamento'); assert.ok(n0[0].command_id);
  assert.equal((await h.call('/api/cards/44')).body.stage, 'fechamento');
  // Mac offline ainda manda a etapa antiga no push → nuvem mantém fechamento
  await push(h, b);
  assert.equal((await h.call('/api/cards/44')).body.stage, 'fechamento', 'nuvem vence');
  assert.equal(rows(h).filter(x => x.source === 'kanzo' && x.card_id === 44).length, 0, 'não reverte para kanzo');
  const cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands; assert.equal(cmds.length, 1);
  // Mac aplica de verdade e ack → histórico não duplica
  comStage(tarefa(b, 44), 'fechamento');
  await h.call('/sync/ack', { method: 'POST', as: 'sync', body: { ids: [cmds[0].id], results: [{ ok: true, op: 'update_task' }] } });
  await push(h, b);
  assert.equal(rows(h).filter(x => x.source === 'painel' && x.card_id === 44).length, 1);
});

test('card criado depois do início do registro: entrada "criacao" com a data real de criação', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  b.projects[0].tasks.push({ id: 9100, key: 'pre-vendas#9100', title: 'NOVO', description: '', status: 'todo', tags: 'stage:recebimento-do-projeto', created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z', comments: [] });
  const desde = h.DATA.db.prepare("SELECT value FROM meta WHERE key='stage_history_desde'").get().value;
  b.projects[0].tasks[b.projects[0].tasks.length - 1].created_at = desde;
  await push(h, b);
  const r = rows(h).find(x => x.card_id === 9100); assert.equal(r.source, 'criacao'); assert.equal(r.from_stage, null);
});

test('/api/stage-history: parados há 7+ dias (abertos; "minimo" quando só há observação inicial); anônimo 401; sem dado de custo', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  const aberto = b.projects[0].tasks.find(t => t.status !== 'done' && !/stage:(old-falhou|fechamento)/.test(t.tags));
  comStage(aberto, 'fechamento'); await push(h, b);
  const dezDias = new Date(Date.now() - 10 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  h.DATA.db.prepare('UPDATE stage_history SET changed_at = ?').run(dezDias);
  const api = (await h.call('/api/stage-history?dias=7', { as: 'viewer' })).body;
  const p44 = api.parados.find(x => x.card_id === aberto.id); assert.ok(p44); assert.equal(p44.minimo, false); assert.equal(p44.dias_na_etapa, 10);
  assert.ok(api.parados.some(x => x.minimo === true && x.dias_minimo === 10), 'observação inicial entra como mínimo ' + JSON.stringify(api.parados.slice(0,3)) + JSON.stringify(api.cards.slice(0,2)));
  assert.ok(api.parados.every(x => x.status !== 'done' && x.stage !== 'old-falhou'));
  assert.equal((await h.call('/api/stage-history', { as: 'anon' })).status, 401);
  assert.doesNotMatch(JSON.stringify(api), /description|custo|margem/i);
});

test('falha no histórico nunca derruba o sync; resposta do push igual à de antes', async () => {
  const h = await montar(); const b = board(); await push(h, b);
  h.DATA.db.exec('DROP TABLE stage_history');
  const r = await push(h, b); for (const k of ['ok', 'synced_at', 'cards', 'comments', 'pending_reapplied']) assert.ok(k in r.body, k);
});

test('painel: "Tempo na etapa" lê /api/stage-history; sem mudança registrada = "sem dado"; nada calculado de updated_at', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const fn = app.slice(app.indexOf('function tempoEtapaTd'), app.indexOf('function renderRanking'));
  assert.match(fn, /\/api\/stage-history/); assert.match(fn, /dias_na_etapa == null/); assert.match(fn, />sem dado<\/td>/);
  assert.doesNotMatch(fn, /updated_at/);
});
