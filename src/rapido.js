/* presales-kanzo · src/rapido.js — Registro rápido pelo celular (feature 6).
   O parser roda no navegador (public/js/rapido-parse.js) e só PROPÕE. Aqui só entra o que o admin confirmou,
   e a escrita reaproveita o caminho do editor (patchCardOnline / addCommentOnline): mesmo payload para o Mac
   (id = chave do card, base_description_sha256, tags preservadas), mesmo espelho, mesma auditoria.
   Ops enfileiradas: só update_task e add_comment (já aceitas pelo agente do Mac). */
'use strict';
import { STAGE_ORDER, macSyncLigado } from './config.js';
import { dataDB, metaGet, audit, markCloudWrite } from './db.js';
import { registrarEtapaPainel } from './etapas.js';
import { getCard, patchCardOnline, addCommentOnline } from './cards.js';
import { json } from './http.js';
import { iso, sha256, iguais } from './util.js';

var FECHAMENTO = { 'ganho-handoff': 1, 'old-falhou': 1 };
var MAX_TXT = 2000;

var LINHA_RAPIDA = /^\s*(?:[-*]\s*)?\*\*(?:Sa[uú]de|Prazo \(Kanzo\)):\*\*.*$/i;
function semCamposRapidos(d) { return String(d || '').replace(/\r\n/g, '\n').split('\n').filter(function (l) { return !LINHA_RAPIDA.test(l) && l.trim() !== ''; }).join('\n'); }
async function corpo(r) { try { return await r.clone().json(); } catch (e) { return null; } }

/* POST /api/rapido/confirm
   { card_id, raw, comentario, stage?, description?, expect_description_sha256?, confirmar_fechamento? } */
export async function confirmarRapido(env, s, b, req) {
  var cardId = parseInt(b && b.card_id, 10);
  if (!(cardId > 0)) return json({ erro: 'Escolha o card.', error: 'card_id' }, 400);
  var raw = String(b.raw || '').trim(), comentario = String(b.comentario || '').trim();
  if (!raw || !comentario) return json({ erro: 'Texto vazio.', error: 'vazio' }, 400);
  if (raw.length > MAX_TXT || comentario.length > MAX_TXT) return json({ erro: 'Texto longo demais (máx. 2.000 caracteres).', error: 'longo' }, 400);
  var stage = b.stage == null || b.stage === '' ? null : String(b.stage);
  if (stage && STAGE_ORDER.indexOf(stage) < 0) return json({ erro: 'Etapa desconhecida.', error: 'stage' }, 400);
  var temDesc = b.description != null;
  if (temDesc && !b.expect_description_sha256) return json({ erro: 'Falta o hash da descrição lida.', error: 'hash' }, 400);

  var card = await getCard(env, cardId);
  if (!card || card.deleted_at) return json({ erro: 'Card não encontrado.', error: 'not_found' }, 404);
  /* Etapa B (09/11): o registro rápido só pode mexer nas linhas Saúde e Prazo (Kanzo) da descrição. Qualquer outra diferença = 400, nada na fila. */
  if (temDesc && !iguais(String(b.expect_description_sha256), await sha256(card.description || ''))) return json({ erro: 'O card mudou desde a sua leitura.', error: 'conflict', current: card }, 409);
  if (temDesc && semCamposRapidos(b.description) !== semCamposRapidos(card.description)) return json({ erro: 'O registro rápido só altera Saúde e Prazo; o resto da descrição precisa ficar igual.', error: 'descricao_fora_do_escopo' }, 400);
  if (stage === card.stage) stage = null;
  if (stage && (FECHAMENTO[stage] || FECHAMENTO[card.stage]) && b.confirmar_fechamento !== true)
    return json({ erro: 'Ganho, perda ou reabertura precisam da confirmação extra.', error: 'confirmar_fechamento' }, 409);

  var antes = await dataDB(env).prepare('SELECT id, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending FROM cards WHERE id = ?').bind(card.id).first();
  var ids = [], comentarioId = null, alvoId = card.id;

  if (stage || temDesc) {
    var patch = {};
    if (stage) patch.stage = stage;
    if (temDesc) { patch.description = String(b.description); patch.expect_description_sha256 = String(b.expect_description_sha256); }
    var r1 = await patchCardOnline(env, s, card.id, patch, req);
    if (r1.status !== 200) return r1; // 409 conflito (card mudou) etc.: nada foi enfileirado
    var j1 = await corpo(r1); ids.push(j1.pending_command_id); alvoId = j1.resolved_id || card.id;
  }
  var r2 = await addCommentOnline(env, s, card.id, { body: comentario }, req);
  var j2 = await corpo(r2);
  if (r2.status !== 200) return json({ erro: 'A mudança foi para a fila, mas o comentário falhou.', error: 'comentario', pending_command_ids: ids }, 500);
  ids.push(j2.pending_command_id); comentarioId = j2.id;

  var proposta = { stage: stage, descricao_alterada: temDesc, confirmar_fechamento: b.confirmar_fechamento === true, comentario: comentario, comentario_id: comentarioId, alvo_id: alvoId, antes: antes };
  /* Remodelo 11/11: com o app como fonte oficial já gravou direto no D1 (status 'applied'); guarda como o card ficou para o desfazer
     saber se alguém mexeu depois. */
  var app = !macSyncLigado(env);
  if (app) {
    var dep = await dataDB(env).prepare('SELECT description, stage, status, title FROM cards WHERE id = ?').bind(card.id).first();
    proposta.app = true; proposta.depois_sha = await sha256((dep && dep.description) || ''); proposta.depois_stage = dep ? dep.stage : null;
    proposta.depois_status = dep ? dep.status : null; proposta.depois_title = dep ? dep.title : null;
  }
  var ins = await dataDB(env).prepare('INSERT INTO quick_entries (created_at, actor_email, raw_text, card_id, proposal_json, command_ids_json, status) VALUES (?,?,?,?,?,?,?)')
    .bind(iso(), (s && s.email) || 'web', raw, card.id, JSON.stringify(proposta), JSON.stringify(app ? [] : ids), app ? 'applied' : 'pending').run();
  var entryId = ins.meta && ins.meta.last_row_id;
  await audit(env, s, 'rapido_confirm', 'card', card.id, null, { entry_id: entryId, command_ids: ids, stage: stage, descricao_alterada: temDesc }, req);
  return json({ ok: true, id: entryId, card_id: card.id, pending_command_ids: app ? [] : ids, app_only: app });
}

/* Status real de cada registro, lido da fila (pending | applied | failed | cancelled). */
function statusDe(cmds) {
  if (!cmds.length) return 'pending';
  if (cmds.every(function (c) { return c.status === 'cancelled'; })) return 'cancelled';
  if (cmds.some(function (c) { return c.status === 'failed'; })) return 'failed';
  if (cmds.every(function (c) { return c.status === 'applied'; })) return 'applied';
  return 'pending';
}
export async function historicoRapido(env, url) {
  var limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
  var rows = (await dataDB(env).prepare('SELECT q.id, q.created_at, q.raw_text, q.card_id, q.command_ids_json, q.status, c.title FROM quick_entries q LEFT JOIN cards c ON c.id = q.card_id ORDER BY q.id DESC LIMIT ?').bind(limit).all()).results || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var q = rows[i], ids = []; try { ids = JSON.parse(q.command_ids_json || '[]'); } catch (e) {}
    var cmds = await lerComandos(env, ids);
    if (!ids.length && q.status !== 'pending') { // gravado direto no app (remodelo 11/11): desfazer enquanto ninguém mexeu no card depois
      out.push({ id: q.id, created_at: q.created_at, raw_text: q.raw_text, card_id: q.card_id, card_title: q.title || null, status: q.status, pode_desfazer: q.status === 'applied' });
      continue;
    }
    out.push({ id: q.id, created_at: q.created_at, raw_text: q.raw_text, card_id: q.card_id, card_title: q.title || null,
      status: q.status === 'cancelled' ? 'cancelled' : statusDe(cmds), pode_desfazer: q.status !== 'cancelled' && cmds.length > 0 && cmds.every(function (c) { return c.status === 'pending'; }) });
  }
  return json({ history: out });
}

async function lerComandos(env, ids) {
  ids = (ids || []).filter(function (x) { return Number.isInteger(x); });
  if (!ids.length) return [];
  var st = dataDB(env).prepare('SELECT id, status, created_at FROM pending_commands WHERE id IN (' + ids.map(function () { return '?'; }).join(',') + ')');
  return (await st.bind.apply(st, ids).all()).results || [];
}

/* POST /api/rapido/:id/undo — só cancela se NENHUM comando saiu da nuvem.
   /sync/pull não marca entrega; então, se houve pull depois do registro, o Mac pode já ter recebido: 409. */
export async function desfazerRapido(env, s, id, req) {
  var q = await dataDB(env).prepare('SELECT * FROM quick_entries WHERE id = ?').bind(id).first();
  if (!q) return json({ erro: 'Registro não encontrado.' }, 404);
  if (q.status === 'cancelled') return json({ erro: 'Já desfeito.', error: 'ja_desfeito' }, 409);
  var ids = []; try { ids = JSON.parse(q.command_ids_json || '[]'); } catch (e) {}
  if (!ids.length && q.status === 'applied') return await desfazerNoApp(env, s, q, req);
  var cmds = await lerComandos(env, ids);
  if (!cmds.length || cmds.length !== ids.length) return json({ erro: 'Comandos do registro não encontrados.' }, 409);
  var naoPend = cmds.filter(function (c) { return c.status !== 'pending'; });
  if (naoPend.length) return json({ erro: naoPend.some(function (c) { return c.status === 'applied'; }) ? 'Já aplicado no Mac. Para voltar, edite o card.' : 'O Mac recusou ou falhou; nada para desfazer.', error: 'nao_pendente', status: statusDe(cmds) }, 409);
  var maxId = Math.max.apply(null, ids);
  var depoisDele = await dataDB(env).prepare("SELECT COUNT(*) AS n FROM pending_commands WHERE entity_id = ? AND id > ? AND status != 'cancelled'").bind(String(q.card_id), maxId).first();
  if (depoisDele && depoisDele.n) return json({ erro: 'O card foi alterado depois deste registro. Desfaça editando o card.', error: 'editado_depois' }, 409);
  var lastPull = await metaGet(env, 'last_pull_at');
  var criado = cmds.map(function (c) { return c.created_at; }).sort()[0];
  if (lastPull && lastPull >= criado) return json({ erro: 'O Mac já buscou a fila depois deste registro e pode estar aplicando. Não dá para desfazer com segurança; confira no card.', error: 'mac_pode_ter_recebido' }, 409);

  var db = dataDB(env), p = {}; try { p = JSON.parse(q.proposal_json || '{}'); } catch (e) {}
  var stmts = [];
  var up = db.prepare("UPDATE pending_commands SET status = 'cancelled', result_json = ?, applied_at = ? WHERE id IN (" + ids.map(function () { return '?'; }).join(',') + ") AND status = 'pending'");
  stmts.push(up.bind.apply(up, [JSON.stringify({ cancelado_por: s && s.email, origem: 'rapido_undo' }), iso()].concat(ids)));
  var a = p.antes;
  if (a && a.id) stmts.push(db.prepare("UPDATE cards SET title = ?, description = ?, status = ?, stage = ?, tags_json = ?, prioridade = ?, atrasado = ?, url = ?, human = ?, pending = CASE WHEN EXISTS (SELECT 1 FROM pending_commands x WHERE x.entity = 'card' AND x.entity_id = ? AND x.status = 'pending') THEN 1 ELSE ? END WHERE id = ?")
    .bind(a.title, a.description, a.status, a.stage, a.tags_json, a.prioridade, a.atrasado, a.url, a.human, String(a.id), a.pending || 0, a.id));
  if (p.comentario_id) stmts.push(db.prepare('DELETE FROM comments WHERE id = ? AND pending = 1').bind(p.comentario_id));
  stmts.push(db.prepare("UPDATE quick_entries SET status = 'cancelled' WHERE id = ?").bind(id));
  await db.batch(stmts);
  var depois = await lerComandos(env, ids);
  var ok = depois.every(function (c) { return c.status === 'cancelled'; });
  var pull2 = await metaGet(env, 'last_pull_at');
  await audit(env, s, 'rapido_undo', 'card', q.card_id, null, { entry_id: id, command_ids: ids, ok: ok }, req);
  if (!ok || (pull2 && pull2 !== lastPull && pull2 >= criado)) return json({ ok: false, erro: 'Desfeito na nuvem, mas o Mac buscou a fila no mesmo instante. Confira o card no Kanzo.', error: 'incerto' }, 409);
  return json({ ok: true, id: id, cancelados: ids });
}

/* Remodelo 11/11: desfazer um registro que gravou direto no app. Só se o card ainda está exatamente como o registro deixou
   (descrição, etapa, status e título); senão 409 e o usuário desfaz editando o card. */
async function desfazerNoApp(env, s, q, req) {
  var db = dataDB(env), p = {}; try { p = JSON.parse(q.proposal_json || '{}'); } catch (e) {}
  var a = p.antes;
  if (!a || !a.id) return json({ erro: 'Registro sem o estado anterior; desfaça editando o card.', error: 'sem_antes' }, 409);
  var cur = await db.prepare('SELECT id, title, description, stage, status, deleted_at FROM cards WHERE id = ?').bind(a.id).first();
  if (!cur || cur.deleted_at) return json({ erro: 'O card não existe mais.', error: 'not_found' }, 409);
  var mesmo = (await sha256(cur.description || '')) === p.depois_sha && (cur.stage || null) === (p.depois_stage || null) && cur.status === p.depois_status && cur.title === p.depois_title;
  if (!mesmo) return json({ erro: 'O card foi alterado depois deste registro. Desfaça editando o card.', error: 'editado_depois' }, 409);
  var agoraIso = iso();
  var stmts = [db.prepare('UPDATE cards SET title = ?, description = ?, status = ?, stage = ?, tags_json = ?, prioridade = ?, atrasado = ?, url = ?, human = ?, pending = 0, updated_at = ? WHERE id = ?')
    .bind(a.title, a.description, a.status, a.stage, a.tags_json, a.prioridade, a.atrasado, a.url, a.human, agoraIso, a.id)];
  if (p.comentario_id) stmts.push(db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ? AND card_id = ?').bind(agoraIso, p.comentario_id, a.id));
  stmts.push(db.prepare("UPDATE quick_entries SET status = 'cancelled' WHERE id = ?").bind(q.id));
  await db.batch(stmts);
  await markCloudWrite(env, a.id, 'update');
  if ((cur.stage || null) !== (a.stage || null)) await registrarEtapaPainel(env, a.id, cur.stage, a.stage, null);
  await audit(env, s, 'rapido_undo', 'card', a.id, null, { entry_id: q.id, app: true, ok: true }, req);
  return json({ ok: true, id: q.id, cancelados: [] });
}
