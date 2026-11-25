/* presales-kanzo · src/sync.js — Sincronização com o Mac: push/snapshot, pull, ack, mapa de ids temporários e status/falhas. */
'use strict';
import { syncSlot, registrarSlot } from './auth.js';
import { MAC_ONLINE_S, macSyncLigado } from './config.js';
import { dataDB, metaGet, metaSet, audit, recordSyncConflict, clearCloudWrite } from './db.js';
import { registrarEtapas } from './etapas.js';
import { K, parseTags, stageFromTags, prioridadeFromTags, isAtrasadoStatus } from './format.js';
import { json, corpoJson } from './http.js';
import { iso } from './util.js';

/* Mapa id temporário da nuvem (ex. 100060) → id real do Mac (#60). Preenchido no /sync/ack do create. */
export async function saveCardIdMap(env, tempId, realId, realKey) {
  if (!tempId || !realId) return;
  await dataDB(env).prepare('INSERT INTO card_id_map (temp_id, real_id, real_key, created_at) VALUES (?,?,?,?) ON CONFLICT(temp_id) DO UPDATE SET real_id = excluded.real_id, real_key = excluded.real_key, created_at = excluded.created_at')
    .bind(Number(tempId), Number(realId), String(realKey || ('pre-vendas#' + realId)), iso()).run();
}

export async function lookupCardIdMap(env, tempId) {
  if (tempId == null || tempId === '') return null;
  return await dataDB(env).prepare('SELECT temp_id, real_id, real_key FROM card_id_map WHERE temp_id = ?').bind(Number(tempId)).first();
}

export function parseRealFromAck(res, payload) {
  var realId = res && res.real_id != null ? Number(res.real_id) : null;
  var realKey = res && res.real_key ? String(res.real_key) : null;
  var tempId = res && res.temp_id != null ? Number(res.temp_id) : (payload && payload.temp_id != null ? Number(payload.temp_id) : null);
  if (!realId || !realKey) {
    var text = '';
    if (res && res.out != null) text = typeof res.out === 'string' ? res.out : JSON.stringify(res.out);
    var m = String(text).match(/([A-Za-z0-9_-]+)#(\d+)/);
    if (m) { realKey = realKey || (m[1] + '#' + m[2]); realId = realId || parseInt(m[2], 10); }
  }
  return { tempId: tempId, realId: realId, realKey: realKey };
}

export async function rewritePendingForTempId(env, tempId, realId, realKey) {
  var db = dataDB(env);
  var rows = (await db.prepare("SELECT id, entity_id, payload_json FROM pending_commands WHERE status = 'pending'").all()).results || [];
  var tip = String(tempId), rid = String(realId);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i], payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) { payload = {}; }
    var changed = false, entityId = row.entity_id;
    if (entityId === tip) { entityId = rid; changed = true; }
    if (payload.id != null && String(payload.id).split('#').pop() === tip) { payload.id = realKey; changed = true; }
    if (payload.temp_id != null && Number(payload.temp_id) === Number(tempId)) { /* keep temp_id for audit */ }
    if (changed) {
      await db.prepare('UPDATE pending_commands SET entity_id = ?, payload_json = ? WHERE id = ?')
        .bind(entityId, JSON.stringify(payload), row.id).run();
    }
  }
  // espelho: remove o card temporário (o push do Mac traz o real)
  await db.prepare('UPDATE cards SET deleted_at = COALESCE(deleted_at, ?), pending = 0, updated_at = ? WHERE id = ?')
    .bind(iso(), iso(), Number(tempId)).run();
}

/* Item 2: comandos cuja ÚLTIMA tentativa por card (7 dias) falhou no Mac — ex.: exclusão recusada pelo delete_guard.
   Some sozinho quando um comando posterior do mesmo card é aplicado. */
export async function falhasAtuais(env) {
  var desde = new Date(Date.now() - 7 * 86400000).toISOString();
  var r = await dataDB(env).prepare("SELECT p.id, p.op, p.entity_id, p.result_json, p.applied_at, c.title, c.deleted_at AS c_del, c.id AS c_id FROM pending_commands p LEFT JOIN cards c ON c.id = CAST(p.entity_id AS INTEGER) WHERE p.entity = 'card' AND p.status = 'failed' AND p.created_at > ? AND p.id = (SELECT MAX(q.id) FROM pending_commands q WHERE q.entity = 'card' AND q.entity_id = p.entity_id) ORDER BY p.id DESC LIMIT 50").bind(desde).all();
  return (r.results || []).map(function (x) {
    var res = {}; try { res = JSON.parse(x.result_json || '{}') || {}; } catch (e) {}
    var m = K.motivoFalha(x.op, res.error);
    return { command_id: x.id, op: x.op, card_id: Number(x.entity_id), title: x.title || null, motivo: res.motivo || m.motivo, recusado: !!(res.refused || m.recusado), at: x.applied_at, card_ativo: !!(x.c_id && !x.c_del) };
  });
}

export function avisoDe(f) { return f ? { tipo: f.op === 'delete_task' && f.recusado ? 'delete_refused' : 'failed', op: f.op, motivo: f.motivo, at: f.at, command_id: f.command_id } : null; }

export async function avisosPorCard(env) {
  var m = {}; (await falhasAtuais(env)).forEach(function (f) { if (!m[f.card_id]) m[f.card_id] = avisoDe(f); }); return m;
}

export async function syncStatus(env) {
  var lastPush = await metaGet(env, 'last_push_at');
  var lastPull = await metaGet(env, 'last_pull_at');
  var lastSnap = await metaGet(env, 'last_snapshot_at');
  var host = await metaGet(env, 'mac_hostname');
  var slotUsado = await metaGet(env, 'sync_token_slot');
  var pending = await dataDB(env).prepare("SELECT COUNT(*) AS n FROM pending_commands WHERE status = 'pending'").first();
  var cards = await dataDB(env).prepare('SELECT COUNT(*) AS n FROM cards WHERE deleted_at IS NULL').first();
  var falhas = await dataDB(env).prepare("SELECT COUNT(*) AS n FROM pending_commands WHERE status = 'failed' AND applied_at > ?").bind(new Date(Date.now() - 7 * 86400000).toISOString()).first();
  var falhasAt = await falhasAtuais(env);
  var recusadas = falhasAt.filter(function (f) { return f.op === 'delete_task' && f.recusado && f.card_ativo; });
  var online = false, msg = null;
  var visto = [lastPush, lastPull, lastSnap].filter(Boolean).sort().pop() || null;
  if (visto) {
    var age = (Date.now() - Date.parse(visto)) / 1000;
    online = age <= MAC_ONLINE_S;
    if (!online) msg = 'Sem contato do Mac há mais de ' + MAC_ONLINE_S + ' s (Mac desligado, dormindo ou sem internet).';
  } else msg = 'Aguardando primeira sincronização do Mac';
  return {
    mac_online: online, last_seen_at: visto, last_push_at: lastPush, last_pull_at: lastPull, last_snapshot_at: lastSnap,
    mac_hostname: host, pending_commands: (pending && pending.n) || 0, mirror_cards: (cards && cards.n) || 0, failed_commands_7d: (falhas && falhas.n) || 0,
    source: 'kanzo-mac', source_of_truth: 'd1', message: macSyncLigado(env) ? msg : 'Kanzo do Mac desligado: o app é a fonte oficial e grava direto no D1.',
    app_only: !macSyncLigado(env),
    refused_deletes: recusadas.length,
    sync_token: { slot_em_uso: slotUsado || null, rotacao_em_andamento: !!env.SYNC_TOKEN_NEXT },
    recent_failures: falhasAt.slice(0, 10).map(function (f) { return { command_id: f.command_id, op: f.op, card_id: f.card_id, title: f.title, motivo: f.motivo, recusado: f.recusado, at: f.at }; })
  };
}

/* Lote 1 nuvem: D1 é a fonte oficial. O push do Mac faz merge — card alterado na nuvem desde a última sync vence;
   mudança só do Mac aplica; card criado na nuvem nunca é apagado; divergência vai para sync_conflicts. Resposta
   continua com ok/synced_at/cards/comments/pending_reapplied (agente atual). */
export async function replaceMirrorFromPush(env, body) {
  var projects = body.projects || [];
  var now = body.exported_at || iso();
  var db = dataDB(env);
  var lastPush = await metaGet(env, 'last_push_at');
  var protectedIds = await idsProtegidosNuvem(env, lastPush);
  var existentes = (await db.prepare('SELECT * FROM cards').all()).results || [];
  var porId = {}; existentes.forEach(function (c) { porId[c.id] = c; });
  var comentariosProt = {};
  var protList = Object.keys(protectedIds);
  if (protList.length) {
    var ph = protList.map(function () { return '?'; }).join(',');
    var stC = db.prepare('SELECT * FROM comments WHERE card_id IN (' + ph + ') AND deleted_at IS NULL');
    var crs = (await stC.bind.apply(stC, protList.map(Number)).all()).results || [];
    crs.forEach(function (c) { (comentariosProt[c.card_id] = comentariosProt[c.card_id] || []).push(c); });
  }

  var stmts = [];
  stmts.push(db.prepare('DELETE FROM comments'));
  stmts.push(db.prepare('DELETE FROM cards'));
  stmts.push(db.prepare('DELETE FROM projects'));
  var seenIds = {}, nCards = 0, nComments = 0, etapasVistas = [], conflitos = 0, cloudKept = 0;
  var macSnap = {}; // id -> {title, description, status, stage, deleted:false}

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    stmts.push(db.prepare('INSERT INTO projects (id, slug, name, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,NULL)')
      .bind(p.id, p.slug, p.name || p.slug, p.created_at || now, now));
    var tasks = p.tasks || [];
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j];
      var tags = parseTags(t.tags);
      var stage = stageFromTags(tags);
      var prior = prioridadeFromTags(tags);
      var atrasado = isAtrasadoStatus(t.status || 'todo', t.description || '') ? 1 : 0;
      var key = t.key || (p.slug + '#' + t.id);
      var tid = Number(t.id);
      seenIds[String(t.id)] = 1;
      macSnap[tid] = { title: t.title || '', description: t.description || '', status: t.status || 'todo', stage: stage, key: key };

      if (protectedIds[tid]) {
        var cur = porId[tid];
        if (cur) {
          // Mantém versão da nuvem; se o Mac divergiu, registra conflito.
          if (divergiu(cur, macSnap[tid])) {
            await recordSyncConflict(env, tid, 'card', resumoCard(cur), macSnap[tid]);
            conflitos++;
          }
          stmts.push(db.prepare('INSERT INTO cards (id, project_id, key, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(cur.id, cur.project_id, cur.key, cur.title, cur.description, cur.status, cur.stage, cur.tags_json, cur.prioridade, cur.atrasado, cur.url || '', cur.human ? 1 : 0, cur.pending ? 1 : 0, cur.created_at, cur.updated_at, cur.deleted_at || null));
          nCards++; cloudKept++;
          etapasVistas.push({ id: tid, stage: cur.stage || null, created_at: cur.created_at || null });
          var keepCs = comentariosProt[tid] || [];
          for (var kc = 0; kc < keepCs.length; kc++) {
            var cc = keepCs[kc];
            stmts.push(db.prepare('INSERT INTO comments (id, card_id, author, body, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,NULL)')
              .bind(cc.id, tid, cc.author || 'web', cc.body || '', cc.pending ? 1 : 0, cc.created_at, cc.updated_at || cc.created_at));
            nComments++;
          }
          continue;
        }
        // Protegido mas sumiu do D1 (não deveria): cai no caminho Mac.
      }

      stmts.push(db.prepare('INSERT INTO cards (id, project_id, key, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,NULL)')
        .bind(t.id, p.id, key, t.title || '', t.description || '', t.status || 'todo', stage, JSON.stringify(tags), prior, atrasado, t.url || '', t.human ? 1 : 0, t.created_at || now, t.updated_at || now));
      nCards++;
      etapasVistas.push({ id: t.id, stage: stage, created_at: t.created_at || null });
      var comments = t.comments || [];
      for (var k = 0; k < comments.length; k++) {
        var c = comments[k];
        stmts.push(db.prepare('INSERT INTO comments (id, card_id, author, body, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,0,?,?,NULL)')
          .bind(c.id, t.id, c.author || 'kanzo', c.body || '', c.created_at || now, c.created_at || now));
        nComments++;
      }
    }
  }

  // Cards só na nuvem (criados no painel / ainda não no Mac): nunca apagar.
  for (var ei = 0; ei < existentes.length; ei++) {
    var ex = existentes[ei];
    if (seenIds[String(ex.id)]) continue;
    if (!protectedIds[ex.id] && !ex.pending) continue; // sumiu no Mac e nuvem não tocou → some do espelho (não reinsere)
    if (!protectedIds[ex.id] && ex.pending) { /* pending sem cloud_writes: ainda assim preservar */ }
    stmts.push(db.prepare('INSERT INTO cards (id, project_id, key, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ex.id, ex.project_id, ex.key, ex.title, ex.description, ex.status, ex.stage, ex.tags_json, ex.prioridade, ex.atrasado, ex.url || '', ex.human ? 1 : 0, ex.pending ? 1 : 0, ex.created_at, ex.updated_at, ex.deleted_at || null));
    nCards++; cloudKept++;
    etapasVistas.push({ id: ex.id, stage: ex.stage || null, created_at: ex.created_at || null });
    var keepCs2 = comentariosProt[ex.id] || [];
    // se não estava em protectedIds mas pending, busca comentários atuais (já deletados do batch planejado — estão em memoria só se protegido)
    if (!keepCs2.length && ex.pending) {
      // comentários desse card estavam no DELETE planejado; releitura impossível após batch. Snapshot antes:
    }
    for (var k2 = 0; k2 < keepCs2.length; k2++) {
      var c2 = keepCs2[k2];
      stmts.push(db.prepare('INSERT INTO comments (id, card_id, author, body, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,NULL)')
        .bind(c2.id, ex.id, c2.author || 'web', c2.body || '', c2.pending ? 1 : 0, c2.created_at, c2.updated_at || c2.created_at));
      nComments++;
    }
    if (protectedIds[ex.id] && macSnap[ex.id] === undefined) {
      // Mac não tem o card; nuvem criou — conflito informativo só se kind create já cobre
    }
  }

  for (var off = 0; off < stmts.length; off += 80) await db.batch(stmts.slice(off, off + 80));
  await registrarEtapas(env, etapasVistas, iso());
  var reaplicados = await reaplicarPendentes(env, seenIds, now);
  await metaSet(env, 'last_push_at', now);
  await metaSet(env, 'mac_hostname', body.hostname || '');
  await metaSet(env, 'source_export', now);
  if (body.snapshot) await metaSet(env, 'last_snapshot_at', now);
  await audit(env, { email: 'sync-agent' }, body.snapshot ? 'snapshot' : 'sync_push', 'mirror', null, null, { projects: projects.length, cards: nCards, comments: nComments, exported_at: now, cloud_kept: cloudKept, conflicts: conflitos }, null);
  return { ok: true, synced_at: now, cards: nCards, comments: nComments, pending_reapplied: reaplicados, cloud_kept: cloudKept, conflicts: conflitos };
}

function resumoCard(c) {
  return { id: c.id, title: c.title, description: c.description, status: c.status, stage: c.stage, deleted_at: c.deleted_at || null, updated_at: c.updated_at };
}
function divergiu(cur, mac) {
  if (!mac) return true;
  if (String(cur.title || '') !== String(mac.title || '')) return true;
  if (String(cur.description || '') !== String(mac.description || '')) return true;
  if (String(cur.status || '') !== String(mac.status || '')) return true;
  if (String(cur.stage || '') !== String(mac.stage || '')) return true;
  if (cur.deleted_at) return true; // nuvem soft-deletou e Mac ainda manda o card
  return false;
}

/* Card protegido: cloud_writes desde a última sync, ou ainda tem comando pendente (inclui create temp_id). */
async function idsProtegidosNuvem(env, lastPush) {
  var db = dataDB(env), out = {};
  var cw = (await db.prepare('SELECT card_id, updated_at, kind FROM cloud_writes').all()).results || [];
  for (var i = 0; i < cw.length; i++) {
    if (!lastPush || String(cw[i].updated_at) >= String(lastPush)) out[cw[i].card_id] = cw[i];
  }
  var pend = (await db.prepare("SELECT id, entity_id, op, payload_json FROM pending_commands WHERE status = 'pending'").all()).results || [];
  for (var j = 0; j < pend.length; j++) {
    var row = pend[j], payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) {}
    if (row.entity_id) out[Number(row.entity_id)] = out[Number(row.entity_id)] || { kind: 'pending', updated_at: null };
    if (payload.temp_id) out[Number(payload.temp_id)] = out[Number(payload.temp_id)] || { kind: 'create', updated_at: null };
  }
  return out;
}

/* v3: reaplica no espelho o efeito dos comandos que o Mac ainda não aplicou. */
export async function reaplicarPendentes(env, seenIds, now) {
  var db = dataDB(env), n = 0;
  var rows = (await db.prepare("SELECT id, op, entity, entity_id, payload_json, actor_email, created_at FROM pending_commands WHERE status = 'pending' ORDER BY id").all()).results || [];
  for (var x = 0; x < rows.length; x++) {
    var row = rows[x], payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) {}
    var cid = row.entity_id ? parseInt(row.entity_id, 10) : null;
    if (row.op === 'update_task' && cid) {
      var cur = await db.prepare('SELECT * FROM cards WHERE id = ?').bind(cid).first(); if (!cur) continue;
      var tags = payload.tags != null ? parseTags(payload.tags) : (function () { try { return JSON.parse(cur.tags_json || '[]'); } catch (e) { return []; } })();
      await db.prepare('UPDATE cards SET title = ?, description = ?, status = ?, stage = ?, tags_json = ?, prioridade = ?, atrasado = ?, url = ?, human = ?, pending = 1 WHERE id = ?')
        .bind(payload.title != null ? String(payload.title) : cur.title, payload.description != null ? String(payload.description) : cur.description,
          payload.status != null ? String(payload.status) : cur.status, stageFromTags(tags) || cur.stage, JSON.stringify(tags), prioridadeFromTags(tags),
          isAtrasadoStatus(payload.status != null ? String(payload.status) : cur.status, payload.description != null ? String(payload.description) : cur.description) ? 1 : 0, payload.url != null ? String(payload.url) : cur.url, payload.human != null ? (payload.human ? 1 : 0) : cur.human, cid).run();
      n++;
    } else if (row.op === 'delete_task' && cid) {
      await db.prepare('UPDATE cards SET deleted_at = ?, pending = 1 WHERE id = ?').bind(now, cid).run(); n++;
    } else if (row.op === 'add_comment' && cid) {
      await db.prepare('INSERT OR IGNORE INTO comments (id, card_id, author, body, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,1,?,?,NULL)')
        .bind(900000000 + row.id, cid, payload.author || row.actor_email || 'web', payload.body || '', row.created_at, row.created_at).run(); n++;
    } else if (row.op === 'create_task' && payload.temp_id) {
      var proj = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(payload.project || '').first();
      var tg = parseTags(payload.tags);
      if (proj) {
        await db.prepare('INSERT OR IGNORE INTO cards (id, project_id, key, title, description, status, stage, tags_json, prioridade, atrasado, url, human, pending, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)')
          .bind(payload.temp_id, proj.id, (payload.project || 'pre-vendas') + '#' + payload.temp_id, payload.title || '', payload.description || '', payload.status || 'todo',
            stageFromTags(tg), JSON.stringify(tg), prioridadeFromTags(tg), isAtrasadoStatus(payload.status || 'todo', payload.description || '') ? 1 : 0, payload.url || '', payload.human ? 1 : 0, row.created_at, row.created_at).run();
        n++;
      }
    }
  }
  return n;
}

/* Rotas do agente do Mac (/sync/*): token obrigatório (SYNC_TOKEN ou SYNC_TOKEN_NEXT). */
export async function handleSync(req, env, p, method) {
  var slot = syncSlot(req, env);
  if (!slot) return json({ erro: 'Token de sync inválido' }, 403);
  await registrarSlot(env, slot);
  if ((p === '/sync/push' || p === '/sync/snapshot') && method === 'POST') {
    var body = await corpoJson(req); if (!body) return json({ erro: 'JSON inválido' }, 400);
    if (p === '/sync/snapshot') body.snapshot = true;
    return json(await replaceMirrorFromPush(env, body));
  }
  if (p === '/sync/pull' && method === 'GET') {
    await metaSet(env, 'last_pull_at', iso());
    var cmds = await dataDB(env).prepare("SELECT id, created_at, op, entity, entity_id, payload_json, actor_email FROM pending_commands WHERE status = 'pending' ORDER BY id LIMIT 50").all();
    var commands = [];
    for (var ci = 0; ci < (cmds.results || []).length; ci++) {
      var c = cmds.results[ci];
      var payload = {}; try { payload = JSON.parse(c.payload_json || '{}'); } catch (e) {}
      var entityId = c.entity_id;
      if (payload.id) {
        var tip = String(payload.id).split('#').pop();
        var mp = await lookupCardIdMap(env, tip);
        if (mp) { payload.id = mp.real_key; entityId = String(mp.real_id); }
      } else if (entityId) {
        var mp2 = await lookupCardIdMap(env, entityId);
        if (mp2) { entityId = String(mp2.real_id); payload.id = mp2.real_key; }
      }
      commands.push({ id: c.id, created_at: c.created_at, op: c.op, entity: c.entity, entity_id: entityId, payload: payload, actor_email: c.actor_email });
    }
    return json({ commands: commands });
  }
  if (p === '/sync/ack' && method === 'POST') {
    var ack = await corpoJson(req); if (!ack) return json({ erro: 'JSON inválido' }, 400);
    var ids = ack.ids || [], results = ack.results || [];
    var mapped = 0, falhas = 0;
    for (var i = 0; i < ids.length; i++) {
      var res = results[i] || {};
      var cmdRow = await dataDB(env).prepare('SELECT id, op, entity, entity_id, payload_json, status FROM pending_commands WHERE id = ?').bind(ids[i]).first();
      var payloadAck = {}; try { payloadAck = JSON.parse((cmdRow && cmdRow.payload_json) || '{}'); } catch (e) {}
      if (res.ok === false) {
        // Item 2: falha/recusa do Mac vira 'failed' com motivo legível; exclusão recusada volta a mostrar o card no espelho.
        var mf = K.motivoFalha((cmdRow && cmdRow.op) || res.op, res.error);
        res = Object.assign({}, res, { motivo: mf.motivo, refused: !!(res.refused || mf.recusado) });
      }
      var upd = await dataDB(env).prepare("UPDATE pending_commands SET status = ?, result_json = ?, applied_at = ? WHERE id = ? AND status = 'pending'")
        .bind(res.ok === false ? 'failed' : 'applied', JSON.stringify(res), iso(), ids[i]).run();
      if (res.ok === false && cmdRow && upd.meta && upd.meta.changes) {
        falhas++;
        if (cmdRow.op === 'delete_task' && res.refused && cmdRow.entity_id) {
          await dataDB(env).prepare('UPDATE cards SET deleted_at = NULL, pending = 0 WHERE id = ?').bind(Number(cmdRow.entity_id)).run();
        }
        await audit(env, { email: 'sync-agent' }, res.refused ? 'sync_refused' : 'sync_failed', cmdRow.entity || 'card', cmdRow.entity_id, null, { command_id: cmdRow.id, op: cmdRow.op, motivo: res.motivo, error: String(res.error || '').slice(0, 300) }, null);
      }
      if (res.ok !== false) {
        if (cmdRow && cmdRow.entity_id) await clearCloudWrite(env, Number(cmdRow.entity_id));
        // Agente pull-only: o Mac não faz mais push, então o ack bem-sucedido limpa a marca "Aguardando o Mac" se não sobrou comando na fila.
        if (cmdRow && cmdRow.entity === 'card' && cmdRow.entity_id) {
          await dataDB(env).prepare("UPDATE cards SET pending = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM pending_commands WHERE entity = 'card' AND entity_id = ? AND status = 'pending')").bind(Number(cmdRow.entity_id), String(cmdRow.entity_id)).run();
        }
        if (payloadAck && payloadAck.temp_id) await clearCloudWrite(env, Number(payloadAck.temp_id));
      }
      if (res.ok !== false && ((cmdRow && cmdRow.op === 'create_task') || res.op === 'create_task')) {
        var parsed = parseRealFromAck(res, payloadAck);
        if (parsed.tempId && parsed.realId && parsed.realKey) {
          await saveCardIdMap(env, parsed.tempId, parsed.realId, parsed.realKey);
          await rewritePendingForTempId(env, parsed.tempId, parsed.realId, parsed.realKey);
          await clearCloudWrite(env, parsed.tempId);
          mapped++;
        }
      }
    }
    await metaSet(env, 'last_pull_at', iso());
    return json({ ok: true, acked: ids.length, id_maps: mapped, failed: falhas });
  }
  return json({ erro: 'Rota sync desconhecida' }, 404);
}

