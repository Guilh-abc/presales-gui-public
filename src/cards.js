/* presales-kanzo · src/cards.js — Cards: DTO, resumo, lista, etapas, histórico e escrita online (vai para a fila do Mac). */
'use strict';
import { STAGE_ORDER, STAGE_LABEL, macSyncLigado } from './config.js';
import { dataDB, metaGet, audit, enqueue, markCloudWrite } from './db.js';
import { registrarEtapaPainel } from './etapas.js';
import { K, parseTags, stageFromTags, prioridadeFromTags, solutionFromTags, solutionFromDescription, valoresDaDescricao, isAtrasadoStatus, diffCard } from './format.js';
import { json } from './http.js';
import { lookupCardIdMap, avisosPorCard, syncStatus } from './sync.js';
import { iso, sha256, iguais } from './util.js';

export async function resolveMacTarget(env, id) {
  var map = await lookupCardIdMap(env, id);
  if (map) return { id: map.real_id, key: map.real_key, temp_id: map.temp_id, mapped: true };
  var card = await getCard(env, id);
  if (card) return { id: card.id, key: card.key || ('pre-vendas#' + card.id), mapped: false };
  return { id: id, key: 'pre-vendas#' + id, mapped: false };
}

/* Perfil leitura (não-admin): descrição e comentários (etapa A, 09/11) sem custo/margem/pricing interno (K.descricaoLeitura). Valores TCV/MRC/OTC
   continuam vindo da descrição completa (são preço ao cliente), então os números do painel são os mesmos do admin. */
export function cardDTO(r, comments, aviso, leitura) {
  var tags = []; try { tags = JSON.parse(r.tags_json || '[]'); } catch (e) { tags = []; }
  var labels = tags.filter(function (t) { return t.indexOf('rotulo:') === 0; }).map(function (t) { return t.slice(7); });
  var stage = r.stage || stageFromTags(tags);
  return {
    id: r.id, project_id: r.project_id, key: r.key, title: r.title, description: leitura ? K.descricaoLeitura(r.description || '') : (r.description || ''),
    status: r.status, stage: stage, stage_label: STAGE_LABEL[stage] || stage, status_label: r.status,
    tags: tags, priority: r.prioridade || prioridadeFromTags(tags), prioridade: r.prioridade || prioridadeFromTags(tags),
    labels: labels, atrasado: isAtrasadoStatus(r.status, r.description), solution: solutionFromDescription(r.description) || solutionFromTags(tags),
    url: r.url || '', human: !!r.human, product_id: r.product_id, solution_id: r.solution_id,
    pending: !!r.pending, values: valoresDaDescricao(r.description), planner: {},
    created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at || null,
    active: !r.deleted_at, comments_count: comments ? comments.length : (r.comments_count || 0),
    comments: (comments || []).map(function (c) { return { id: c.id, author: c.author, body: leitura ? K.descricaoLeitura(c.body || '') : c.body, created_at: c.created_at }; }),
    sync_warning: aviso || null
  };
}

export var ACTION_NOW_PADRAO = 12;
/* Item 5: action_now continua com 12 por padrão (compatível); ?action_all=1 devolve todos; action_now_total diz quantos existem. */
export async function getSummary(env, url) {
  var todos = !!(url && url.searchParams && url.searchParams.get('action_all') === '1');
  var st = await syncStatus(env);
  var allRows = await dataDB(env).prepare('SELECT id, title, stage, status, description, updated_at FROM cards WHERE deleted_at IS NULL').all();
  var byStatus = {}, byStage = {}, atrasados = 0, total = 0, open = 0, actionCand = [];
  (allRows.results || []).forEach(function (r) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.stage) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    var atr = isAtrasadoStatus(r.status, r.description);
    if (atr) atrasados++;
    total++; if (r.status !== 'done') open++;
    if (atr || r.status === 'todo' || r.status === 'doing') actionCand.push({ id: r.id, title: r.title, stage: r.stage, status: r.status, atr: atr, updated: r.updated_at });
  });
  var proj = await dataDB(env).prepare('SELECT slug, name FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1').first();
  actionCand.sort(function (a, b) { return (b.atr - a.atr) || String(b.updated || '').localeCompare(String(a.updated || '')); });
  var actionNow = (todos ? actionCand : actionCand.slice(0, ACTION_NOW_PADRAO)).map(function (r) {
    var reasons = []; if (r.atr) reasons.push('atrasado'); if (r.status === 'todo') reasons.push('todo');
    return { id: r.id, title: r.title, stage: r.stage, status: r.status, reasons: reasons };
  });
  var allDesc = { results: allRows.results || [] };
  var tcvSum = 0, mrcSum = 0, otcSum = 0, withTcv = [];
  (allDesc.results || []).forEach(function (row) {
    var v = valoresDaDescricao(row.description);
    if (typeof v.tcv === 'number') { tcvSum += v.tcv; withTcv.push({ id: row.id, title: row.title, tcv: v.tcv, mrc: v.mrc == null ? null : v.mrc, otc: v.otc == null ? null : v.otc }); }
    if (typeof v.mrc === 'number') mrcSum += v.mrc;
    if (typeof v.otc === 'number') otcSum += v.otc;
  });
  withTcv.sort(function (a, b) { return b.tcv - a.tcv; });
  return {
    synced_at: st.last_push_at, sync: st, project: proj || null,
    totals: { cards: total, open: open, done: byStatus.done || 0, atrasados: atrasados, by_status: byStatus, by_stage: byStage, tcv: tcvSum, mrc: mrcSum, otc: otcSum, tcv_cards: withTcv.length },
    tcv_cards: withTcv, action_now: actionNow, action_now_total: actionCand.length
  };
}

export async function listCards(env, url, leitura) {
  var status = url.searchParams.get('status');
  var stage = url.searchParams.get('stage');
  var q = url.searchParams.get('q');
  var includeDeleted = url.searchParams.get('include_deleted') === '1';
  var limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 500);
  var offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  var sql = 'SELECT c.*, (SELECT COUNT(*) FROM comments x WHERE x.card_id = c.id AND x.deleted_at IS NULL) AS comments_count FROM cards c WHERE 1=1';
  var binds = [];
  if (!includeDeleted) sql += ' AND c.deleted_at IS NULL';
  if (status) { sql += ' AND c.status = ?'; binds.push(status); }
  if (stage) { sql += ' AND c.stage = ?'; binds.push(stage); }
  // Leitura: a busca não pode olhar o texto cortado (senão vira um "oráculo" de custo/margem); filtra depois do corte.
  var qLeitura = leitura && q ? String(q).toLowerCase() : null;
  if (q && !qLeitura) { sql += ' AND (c.title LIKE ? OR c.description LIKE ?)'; binds.push('%' + q + '%', '%' + q + '%'); }
  sql += ' ORDER BY c.updated_at DESC LIMIT ? OFFSET ?';
  if (qLeitura) binds.push(500, 0); else binds.push(limit, offset);
  var stmt = dataDB(env).prepare(sql);
  var r = await stmt.bind.apply(stmt, binds).all();
  var app = !macSyncLigado(env), avisos = app ? {} : await avisosPorCard(env);
  var cards = (r.results || []).map(function (row) { return semFilaMac(cardDTO(row, null, avisos[row.id], leitura), app); });
  if (qLeitura) cards = cards.filter(function (c) { return (String(c.title || '') + '\n' + c.description).toLowerCase().indexOf(qLeitura) >= 0; }).slice(offset, offset + limit);
  // attach comments lightly? list without full comments for speed; drawer fetches by id
  var synced = await metaGet(env, 'last_push_at');
  return { synced_at: synced, meta: { updated_at: synced }, total: cards.length, cards: cards };
}

export async function getCard(env, id, leitura) {
  var r = await dataDB(env).prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
  if (!r) return null;
  var cs = await dataDB(env).prepare('SELECT * FROM comments WHERE card_id = ? AND deleted_at IS NULL ORDER BY id').bind(id).all();
  var app = !macSyncLigado(env), avisos = app ? {} : await avisosPorCard(env);
  return semFilaMac(cardDTO(r, cs.results || [], avisos[r.id], leitura), app);
}

/* Remodelo 11/11: com o Mac desligado, nada fica "aguardando o Mac" nem com aviso de comando recusado (marcas antigas do D1 somem da tela). */
function semFilaMac(dto, app) { if (app) { dto.pending = false; dto.sync_warning = null; } return dto; }
async function estadoEscrita(env) { if (!macSyncLigado(env)) return { app_only: true, mac_online: false }; var st = await syncStatus(env); return { mac_online: st.mac_online }; }

export async function auditCard(env, id, leitura) {
  var r = await dataDB(env).prepare("SELECT a.id, a.at, a.actor_email, u.nome, a.action, a.before_json, a.after_json FROM audit_log a LEFT JOIN presales_users u ON u.email = a.actor_email WHERE a.entity = 'card' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 30").bind(String(id)).all();
  var cmds = await dataDB(env).prepare("SELECT id, op, status, created_at, applied_at, result_json FROM pending_commands WHERE entity = 'card' AND entity_id = ? ORDER BY id DESC LIMIT 30").bind(String(id)).all();
  return {
    events: (r.results || []).map(function (e) {
      var a = null, b = null; try { a = JSON.parse(e.before_json || 'null'); } catch (x) {} try { b = JSON.parse(e.after_json || 'null'); } catch (x) {}
      if (leitura) { if (a && a.description) a.description = K.descricaoLeitura(a.description); if (b && b.description) b.description = K.descricaoLeitura(b.description); }
      return { id: e.id, at: e.at, by: e.nome || e.actor_email || 'desconhecido', action: e.action, changes: e.action === 'update' ? diffCard(a, b) : [] };
    }),
    commands: (cmds.results || []).map(function (c) { var res = null; try { res = JSON.parse(c.result_json || 'null'); } catch (x) {} var falhou = res && res.ok === false; return { id: c.id, status: c.status, created_at: c.created_at, applied_at: c.applied_at, error: falhou ? String(res.error || 'falhou') : null, motivo: falhou ? (res.motivo || K.motivoFalha(c.op, res.error).motivo) : null }; })
  };
}

export async function createCardOnline(env, s, b, req) {
  var title = String(b.title || '').trim(); if (!title) return json({ erro: 'title obrigatório', error: 'title' }, 400);
  var mac = macSyncLigado(env);
  var proj = await dataDB(env).prepare('SELECT id, slug FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1').first();
  if (!proj && !mac) {
    var agoraP = iso();
    await dataDB(env).prepare("INSERT INTO projects (slug, name, created_at, updated_at) VALUES ('pre-vendas', 'Pré-vendas', ?, ?)").bind(agoraP, agoraP).run();
    proj = await dataDB(env).prepare('SELECT id, slug FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1').first();
  }
  if (!proj) return json({ erro: 'Sem projeto no espelho. Aguarde sync do Mac.', error: 'no_project' }, 409);
  var tags = parseTags(b.tags);
  if (b.stage) { tags = tags.filter(function (t) { return t.indexOf('stage:') !== 0; }); tags.push('stage:' + b.stage); }
  if (b.solution && b.solution !== 'A definir') { tags = tags.filter(function (t) { return t.indexOf('solucao:') !== 0; }); tags.push('solucao:' + b.solution); }
  var status = b.status || 'todo';
  var payload = { title: title, description: b.description || '', status: status, tags: tags.join(','), url: b.url || '', human: !!b.human, project: proj.slug };
  var cmdId = null, id;
  var max = await dataDB(env).prepare('SELECT COALESCE(MAX(id),0) AS m FROM cards').first();
  if (mac) {
    cmdId = await enqueue(env, s, 'create_task', 'card', null, payload);
    id = (max.m || 0) + 100000 + (cmdId || 1);
    payload.temp_id = id; // v3: permite reaplicar o card novo no espelho até o Mac criar
    await dataDB(env).prepare('UPDATE pending_commands SET payload_json = ? WHERE id = ?').bind(JSON.stringify(payload), cmdId).run();
  } else id = (max.m || 0) + 1; // app = fonte oficial: id definitivo na hora, nada na fila do Mac
  var now = iso();
  var key = proj.slug + '#' + id;
  await dataDB(env).prepare('INSERT INTO cards (id, project_id, key, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
    .bind(id, proj.id, key, title, b.description || '', status, stageFromTags(tags), JSON.stringify(tags), prioridadeFromTags(tags), isAtrasadoStatus(status, b.description || '') ? 1 : 0, b.url || '', b.human ? 1 : 0, mac ? 1 : 0, now, now).run();
  await markCloudWrite(env, id, 'create');
  await registrarEtapaPainel(env, id, null, stageFromTags(tags), cmdId);
  await audit(env, s, 'create', 'card', id, null, { title: title, pending_command_id: cmdId }, req);
  var card = await getCard(env, id);
  return json(Object.assign({ ok: true, pending_command_id: cmdId }, await estadoEscrita(env), card));
}

export async function patchCardOnline(env, s, id, b, req) {
  var before = await getCard(env, id);
  var target = await resolveMacTarget(env, id);
  if ((!before || before.deleted_at) && target.mapped) before = await getCard(env, target.id);
  if (!before || before.deleted_at) return json({ erro: 'Não encontrado', error: 'not_found' }, 404);
  // Qualquer PATCH que reenvie a descrição precisa do hash do texto atual no servidor.
  // Sem o hash, ou com hash defasado, devolve 409 e não grava (caso CLIENTE DELTA F200G em 17/11).
  var baseHash = await sha256(before.description || '');
  if (b.description != null && (!b.expect_description_sha256 || !iguais(String(b.expect_description_sha256), baseHash))) return json(Object.assign({ erro: 'O card mudou desde a sua leitura.', error: 'conflict' }, { current: before }), 409);
  var tags = b.tags != null ? parseTags(b.tags) : (before.tags || []).slice();
  if (b.stage != null) { tags = tags.filter(function (t) { return t.indexOf('stage:') !== 0; }); if (b.stage) tags.push('stage:' + b.stage); }
  if (b.solution != null) { tags = tags.filter(function (t) { return t.indexOf('solucao:') !== 0; }); if (b.solution && b.solution !== 'A definir') tags.push('solucao:' + b.solution); }
  var payload = { id: target.key || before.key || ('pre-vendas#' + target.id), base_description_sha256: baseHash };
  if (target.mapped) payload.temp_id = target.temp_id;
  if (b.title != null) payload.title = String(b.title);
  if (b.description != null) payload.description = String(b.description);
  if (b.status != null) payload.status = String(b.status);
  if (b.url != null) payload.url = String(b.url);
  if (b.human != null) payload.human = !!b.human;
  if (b.tags != null || b.stage != null || b.solution != null) payload.tags = tags.join(',');
  var mac = macSyncLigado(env);
  var cmdId = mac ? await enqueue(env, s, 'update_task', 'card', target.id, payload) : null;
  var now = iso();
  var novaEtapa = stageFromTags(tags);
  await dataDB(env).prepare('UPDATE cards SET title = ?, description = ?, status = ?, stage = ?, tags_json = ?, prioridade = ?, atrasado = ?, url = ?, human = ?, pending = ' + (mac ? 1 : 0) + ', updated_at = ? WHERE id = ?')
    .bind(b.title != null ? String(b.title) : before.title,
      b.description != null ? String(b.description) : before.description,
      b.status != null ? String(b.status) : before.status,
      novaEtapa, JSON.stringify(tags), prioridadeFromTags(tags), isAtrasadoStatus(payload.status != null ? payload.status : before.status, payload.description != null ? payload.description : before.description) ? 1 : 0,
      b.url != null ? String(b.url) : before.url, b.human != null ? (b.human ? 1 : 0) : (before.human ? 1 : 0),
      now, before.id).run();
  await markCloudWrite(env, before.id, 'update');
  if ((before.stage || null) !== (novaEtapa || null)) await registrarEtapaPainel(env, before.id, before.stage, novaEtapa, cmdId);
  await audit(env, s, 'update', 'card', before.id, before, await getCard(env, before.id), req);
  return json(Object.assign({ ok: true, pending_command_id: cmdId }, await estadoEscrita(env), { resolved_id: target.id }, await getCard(env, before.id)));
}

export async function deleteCardOnline(env, s, id, req) {
  var before = await getCard(env, id);
  var target = await resolveMacTarget(env, id);
  if ((!before || before.deleted_at) && target.mapped) before = await getCard(env, target.id);
  if (!before || before.deleted_at) return json({ erro: 'Não encontrado' }, 404);
  // Guarda anti-colisão: Mac só apaga se título/hash baterem com o card que a nuvem viu.
  // Se o id-map apontar para o id errado, o título não casa e o agente recusa.
  var payload = {
    id: target.key || before.key || ('pre-vendas#' + target.id),
    expected_title: before.title || '',
    expected_description_sha256: await sha256(before.description || '')
  };
  if (target.mapped) payload.temp_id = target.temp_id;
  var mac = macSyncLigado(env), pend = mac ? 1 : 0;
  var cmdId = mac ? await enqueue(env, s, 'delete_task', 'card', target.id, payload) : null;
  var now = iso();
  await dataDB(env).prepare('UPDATE cards SET deleted_at = ?, pending = ?, updated_at = ? WHERE id = ?').bind(now, pend, now, before.id).run();
  await markCloudWrite(env, before.id, 'delete');
  if (target.mapped && target.id !== before.id) {
    await dataDB(env).prepare('UPDATE cards SET deleted_at = ?, pending = ?, updated_at = ? WHERE id = ?').bind(now, pend, now, target.id).run();
    await markCloudWrite(env, target.id, 'delete');
  }
  await audit(env, s, 'delete', 'card', before.id, before, null, req);
  return json(Object.assign({ ok: true, pending_command_id: cmdId }, await estadoEscrita(env), { resolved_id: target.id, mapped_from: target.mapped ? target.temp_id : null }));
}

export async function addCommentOnline(env, s, cardId, b, req) {
  var card = await getCard(env, cardId); if (!card || card.deleted_at) return json({ erro: 'Card não encontrado' }, 404);
  var body = String(b.body || '').trim(); if (!body) return json({ erro: 'body obrigatório' }, 400);
  var author = String(b.author || s.nome || s.email || 'web').slice(0, 80);
  var payload = { id: card.key || ('pre-vendas#' + cardId), body: body, author: author };
  var mac = macSyncLigado(env);
  var cmdId = mac ? await enqueue(env, s, 'add_comment', 'comment', cardId, payload) : null;
  var max = await dataDB(env).prepare('SELECT COALESCE(MAX(id),0) AS m FROM comments').first();
  var id = mac ? (max.m || 0) + 100000 + (cmdId || 1) : (max.m || 0) + 1;
  var now = iso();
  await dataDB(env).prepare('INSERT INTO comments (id, card_id, author, body, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,NULL)')
    .bind(id, cardId, author, body, mac ? 1 : 0, now, now).run();
  await markCloudWrite(env, cardId, 'comment');
  await audit(env, s, 'create', 'comment', id, null, { card_id: cardId, body: body }, req);
  return json(Object.assign({ ok: true, id: id, card_id: cardId, author: author, body: body, pending: mac, created_at: now, pending_command_id: cmdId }, await estadoEscrita(env)));
}

export async function getStages(env) {
  var counts = await dataDB(env).prepare("SELECT stage, COUNT(*) AS n, SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open FROM cards WHERE deleted_at IS NULL AND stage IS NOT NULL GROUP BY stage").all();
  var map = {}; (counts.results || []).forEach(function (r) { map[r.stage] = r; });
  var stages = STAGE_ORDER.map(function (id, order) {
    var r = map[id] || { n: 0, open: 0 };
    return { key: id, id: id, label: STAGE_LABEL[id] || id, order: order, count: r.n || 0, open: r.open || 0 };
  });
  Object.keys(map).forEach(function (id) {
    if (STAGE_ORDER.indexOf(id) < 0) stages.push({ key: id, id: id, label: id, order: 99, count: map[id].n, open: map[id].open });
  });
  return { stages: stages };
}

