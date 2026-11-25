/* presales-kanzo · src/tarefas.js — Tarefas dentro do card (remodelo 11/11/2026, migração 7: card_tasks).
   Estilo Planner, do jeito do Guilherme: tarefa livre com prazo, marcar feita/desfazer, editar, excluir; e sugestões da etapa
   (seed em public/js/kanzo-core.js) que viram linha só quando ele marca como feita, adiciona ou dispensa.
   Grava direto no D1 (o app é a fonte oficial; nada vai para o Mac). Leitura para qualquer sessão; escrita só admin (rotas).
   Perfil leitura: sem custo/margem — título com termo sensível + número sai como "[trecho interno omitido]"; sugestões não vão. */
'use strict';
import { dataDB, audit } from './db.js';
import { K } from './format.js';
import { json } from './http.js';
import { iso } from './util.js';

var MAX_TITULO = 200, MAX_POR_CARD = 100;

function dataValida(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  var t = new Date(d + 'T12:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d;
}
/* due_date: undefined = não mexe; '' ou null = sem prazo; 'AAAA-MM-DD' válida = prazo. Inválida → erro. */
function lerPrazo(v) {
  if (v === undefined) return { ok: true, mexe: false };
  if (v === null || v === '') return { ok: true, mexe: true, valor: null };
  var s = String(v).trim();
  return dataValida(s) ? { ok: true, mexe: true, valor: s } : { ok: false };
}
function lerTitulo(v) { var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length ? t.slice(0, MAX_TITULO) : ''; }

export function tarefaDTO(r, leitura) {
  return {
    id: r.id, card_id: r.card_id, title: leitura ? K.trechoLeitura(r.title) : r.title, due_date: r.due_date || null,
    done: !!r.done, done_at: r.done_at || null, source: r.source === 'suggestion' ? 'suggestion' : 'user', sugg_key: r.sugg_key || null,
    stage: r.stage || null, dismissed: !!r.dismissed, created_by: leitura ? null : (r.created_by || null), created_at: r.created_at, updated_at: r.updated_at
  };
}

async function cardAtivo(env, cardId) {
  return await dataDB(env).prepare('SELECT id, title, stage, deleted_at FROM cards WHERE id = ? AND deleted_at IS NULL').bind(cardId).first();
}
/* 12/11 (migração 8): início real da tarefa (nasce pendente). Com done_at dá o tempo gasto do relatório diário. Nunca sobrescreve. */
async function marcarInicio(env, taskId, quando) {
  if (!taskId) return;
  await dataDB(env).prepare('INSERT OR IGNORE INTO task_times (task_id, started_at) VALUES (?, ?)').bind(taskId, quando).run();
}
async function lerTarefa(env, id) { return await dataDB(env).prepare('SELECT * FROM card_tasks WHERE id = ?').bind(id).first(); }

/* GET /api/tasks[?card_id=N] — tarefas de cards ativos. Admin recebe também o seed de sugestões por etapa. */
export async function listarTarefas(env, url, leitura) {
  var cid = parseInt(url.searchParams.get('card_id') || '', 10);
  var sql = 'SELECT t.* FROM card_tasks t JOIN cards c ON c.id = t.card_id AND c.deleted_at IS NULL WHERE t.deleted_at IS NULL';
  var binds = [];
  if (cid > 0) { sql += ' AND t.card_id = ?'; binds.push(cid); }
  if (leitura) sql += ' AND t.dismissed = 0';
  sql += ' ORDER BY t.card_id, t.done, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.position, t.id';
  var st = dataDB(env).prepare(sql);
  var r = await (binds.length ? st.bind.apply(st, binds) : st).all();
  var out = { tasks: (r.results || []).map(function (x) { return tarefaDTO(x, leitura); }) };
  if (!leitura) out.sugestoes = K.SUGESTOES_ETAPA;
  return out;
}

/* POST /api/cards/:id/tasks
   { title, due_date? }                                → tarefa livre (source 'user')
   { source: 'suggestion', sugg_key, done?, dismissed?, due_date? } → materializa a sugestão da etapa (idempotente por card+sugg_key) */
export async function criarTarefa(env, s, cardId, b, req) {
  var card = await cardAtivo(env, cardId);
  if (!card) return json({ erro: 'Card não encontrado.', error: 'not_found' }, 404);
  var pz = lerPrazo(b.due_date); if (!pz.ok) return json({ erro: 'Prazo inválido (use AAAA-MM-DD).', error: 'due_date' }, 400);
  var db = dataDB(env), now = iso(), quem = (s && (s.email || s.nome)) || 'web';
  if (b.source === 'suggestion') {
    var sg = K.sugestaoPorChave(String(b.sugg_key || ''));
    if (!sg) return json({ erro: 'Sugestão desconhecida.', error: 'sugg_key' }, 400);
    var done = b.done === true ? 1 : 0, dismissed = !done && b.dismissed === true ? 1 : 0;
    var ex = await db.prepare('SELECT * FROM card_tasks WHERE card_id = ? AND sugg_key = ? ORDER BY id LIMIT 1').bind(cardId, sg.key).first();
    if (ex) {
      await db.prepare('UPDATE card_tasks SET done = ?, done_at = ?, dismissed = ?, due_date = COALESCE(?, due_date), deleted_at = NULL, updated_at = ? WHERE id = ?')
        .bind(done, done ? now : null, dismissed, pz.mexe ? pz.valor : null, now, ex.id).run();
      var atual = await lerTarefa(env, ex.id);
      await audit(env, s, 'task_update', 'task', ex.id, tarefaDTO(ex), tarefaDTO(atual), req);
      return json(Object.assign({ ok: true }, tarefaDTO(atual)));
    }
    var insS = await db.prepare('INSERT INTO card_tasks (card_id, title, due_date, done, done_at, source, sugg_key, stage, dismissed, position, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(cardId, sg.title, pz.mexe ? pz.valor : null, done, done ? now : null, 'suggestion', sg.key, sg.stage, dismissed, 0, quem, now, now).run();
    if (!done && !dismissed) await marcarInicio(env, insS.meta.last_row_id, now);
    var novaS = await lerTarefa(env, insS.meta.last_row_id);
    await audit(env, s, 'task_create', 'task', novaS.id, null, tarefaDTO(novaS), req);
    return json(Object.assign({ ok: true }, tarefaDTO(novaS)));
  }
  var titulo = lerTitulo(b.title);
  if (!titulo) return json({ erro: 'Escreva a tarefa.', error: 'title' }, 400);
  var n = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p FROM card_tasks WHERE card_id = ? AND deleted_at IS NULL').bind(cardId).first();
  if (n && n.n >= MAX_POR_CARD) return json({ erro: 'Limite de ' + MAX_POR_CARD + ' tarefas neste card.', error: 'limite' }, 400);
  var ins = await db.prepare('INSERT INTO card_tasks (card_id, title, due_date, done, done_at, source, sugg_key, stage, dismissed, position, created_by, created_at, updated_at) VALUES (?,?,?,0,NULL,?,NULL,?,0,?,?,?,?)')
    .bind(cardId, titulo, pz.mexe ? pz.valor : null, 'user', card.stage || null, ((n && n.p) || 0) + 1, quem, now, now).run();
  await marcarInicio(env, ins.meta.last_row_id, now);
  var nova = await lerTarefa(env, ins.meta.last_row_id);
  await audit(env, s, 'task_create', 'task', nova.id, null, tarefaDTO(nova), req);
  return json(Object.assign({ ok: true }, tarefaDTO(nova)));
}

/* PATCH /api/tasks/:id  { title?, due_date?, done?, dismissed? }  (dispensar só vale para sugestão) */
export async function editarTarefa(env, s, id, b, req) {
  var t = await lerTarefa(env, id);
  if (!t || t.deleted_at || !(await cardAtivo(env, t.card_id))) return json({ erro: 'Tarefa não encontrada.', error: 'not_found' }, 404);
  var pz = lerPrazo(b.due_date); if (!pz.ok) return json({ erro: 'Prazo inválido (use AAAA-MM-DD).', error: 'due_date' }, 400);
  var titulo = t.title;
  if (b.title !== undefined) {
    if (t.source === 'suggestion') return json({ erro: 'O texto de uma sugestão da etapa não muda; crie uma tarefa sua.', error: 'title' }, 400);
    titulo = lerTitulo(b.title); if (!titulo) return json({ erro: 'Escreva a tarefa.', error: 'title' }, 400);
  }
  if (b.dismissed !== undefined && t.source !== 'suggestion') return json({ erro: 'Só sugestões da etapa podem ser dispensadas; exclua a tarefa.', error: 'dismissed' }, 400);
  var now = iso();
  var done = b.done !== undefined ? (b.done ? 1 : 0) : t.done;
  var dismissed = b.dismissed !== undefined ? (b.dismissed ? 1 : 0) : t.dismissed;
  if (done && b.done !== undefined) dismissed = 0;
  var doneAt = done ? (t.done ? t.done_at : now) : null;
  await dataDB(env).prepare('UPDATE card_tasks SET title = ?, due_date = ?, done = ?, done_at = ?, dismissed = ?, updated_at = ? WHERE id = ?')
    .bind(titulo, pz.mexe ? pz.valor : t.due_date, done, doneAt, dismissed, now, id).run();
  var depois = await lerTarefa(env, id);
  await audit(env, s, 'task_update', 'task', id, tarefaDTO(t), tarefaDTO(depois), req);
  return json(Object.assign({ ok: true }, tarefaDTO(depois)));
}

/* DELETE /api/tasks/:id — some da lista (deleted_at). Sugestão excluída volta a ser só sugestão se a etapa ainda for a dela. */
export async function excluirTarefa(env, s, id, req) {
  var t = await lerTarefa(env, id);
  if (!t || t.deleted_at) return json({ erro: 'Tarefa não encontrada.', error: 'not_found' }, 404);
  var now = iso();
  await dataDB(env).prepare('UPDATE card_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
  await audit(env, s, 'task_delete', 'task', id, tarefaDTO(t), null, req);
  return json({ ok: true, id: id });
}
