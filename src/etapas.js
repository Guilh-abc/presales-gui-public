/* presales-kanzo · src/etapas.js — Histórico de etapa (item 1, 09/11/2026).
   Lote 1 nuvem: a etapa oficial vive no D1. O painel grava stage_history na hora (source=painel). A cada push, comparamos a etapa
   de cada card com a ÚLTIMA etapa registrada em stage_history (não com o espelho, que pode estar com edição pendente).
   - card sem nenhum registro: grava 'inicio' (observação inicial, NÃO é mudança; ponto de partida = quando o registro começou),
     ou 'criacao' se o card foi criado depois do início do registro (entrou na etapa ao nascer).
   - etapa diferente da última: grava a mudança. Se houve comando do painel (update_task com stage:X) aplicado pelo Mac
     desde o último registro, a origem é 'painel' (com command_id e a hora do ack); senão 'kanzo' (hora do push).
   Nunca derruba o sync: qualquer erro aqui é engolido e registrado no audit. Nada é inventado para o passado. */
'use strict';
import { dataDB, metaGet, metaSet, audit } from './db.js';
import { STAGE_LABEL } from './config.js';
import { iso } from './util.js';
import { json } from './http.js';

var CHAVE_DESDE = 'stage_history_desde';

/* Grava mudança de etapa feita no painel/rápido na hora (não espera o Mac). Idempotente se a última já é a mesma. */
export async function registrarEtapaPainel(env, cardId, fromStage, toStage, commandId) {
  try {
    var db = dataDB(env), now = iso();
    var desde = await metaGet(env, CHAVE_DESDE);
    if (!desde) { desde = now; await metaSet(env, CHAVE_DESDE, desde); }
    var ult = await db.prepare('SELECT to_stage FROM stage_history WHERE card_id = ? ORDER BY id DESC LIMIT 1').bind(Number(cardId)).first();
    if (ult && (ult.to_stage || null) === (toStage || null)) return;
    if (!ult) {
      await db.prepare('INSERT INTO stage_history (card_id, from_stage, to_stage, changed_at, source, command_id, recorded_at) VALUES (?,?,?,?,?,?,?)')
        .bind(Number(cardId), null, toStage || null, now, 'criacao', commandId || null, now).run();
      return;
    }
    await db.prepare('INSERT INTO stage_history (card_id, from_stage, to_stage, changed_at, source, command_id, recorded_at) VALUES (?,?,?,?,?,?,?)')
      .bind(Number(cardId), fromStage || ult.to_stage || null, toStage || null, now, 'painel', commandId || null, now).run();
  } catch (e) {
    try { await audit(env, { email: 'web' }, 'stage_history_erro', 'card', cardId, null, { erro: String(e && e.message || e).slice(0, 300) }, null); } catch (e2) {}
  }
}


async function ultimos(db) {
  var r = await db.prepare('SELECT h.card_id, h.to_stage, h.changed_at, h.source FROM stage_history h JOIN (SELECT card_id, MAX(id) AS m FROM stage_history GROUP BY card_id) u ON u.m = h.id').all();
  var o = {}; (r.results || []).forEach(function (x) { o[x.card_id] = x; }); return o;
}

/* cards: [{ id, stage, created_at }] como vieram do Mac. */
export async function registrarEtapas(env, cards, agoraIso) {
  try {
    var db = dataDB(env), now = agoraIso || iso();
    var desde = await metaGet(env, CHAVE_DESDE);
    if (!desde) { desde = now; await metaSet(env, CHAVE_DESDE, desde); }
    var ult = await ultimos(db), stmts = [], novos = 0, mudancas = 0;
    var cmds = null;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i]; if (c.id == null) continue;
      var st = c.stage || null, u = ult[c.id];
      if (!u) {
        var criadoDepois = c.created_at && c.created_at >= desde && c.created_at <= now;
        stmts.push(db.prepare('INSERT INTO stage_history (card_id, from_stage, to_stage, changed_at, source, command_id, recorded_at) VALUES (?,?,?,?,?,?,?)')
          .bind(c.id, null, st, criadoDepois ? c.created_at : now, criadoDepois ? 'criacao' : 'inicio', null, now));
        novos++; continue;
      }
      if ((u.to_stage || null) === st) continue;
      if (cmds === null) {
        var r = await db.prepare("SELECT id, entity_id, payload_json, applied_at FROM pending_commands WHERE op = 'update_task' AND status = 'applied' AND applied_at >= ? ORDER BY id DESC LIMIT 200").bind(desde).all();
        cmds = r.results || [];
      }
      var cmd = null;
      for (var j = 0; j < cmds.length; j++) {
        var k = cmds[j]; if (String(k.entity_id) !== String(c.id) || !(k.applied_at >= u.changed_at)) continue;
        var p = {}; try { p = JSON.parse(k.payload_json || '{}'); } catch (e) {}
        if (p.tags != null && String(p.tags).split(',').map(function (t) { return t.trim(); }).indexOf('stage:' + st) >= 0) { cmd = k; break; }
      }
      stmts.push(db.prepare('INSERT INTO stage_history (card_id, from_stage, to_stage, changed_at, source, command_id, recorded_at) VALUES (?,?,?,?,?,?,?)')
        .bind(c.id, u.to_stage || null, st, cmd ? (cmd.applied_at || now) : now, cmd ? 'painel' : 'kanzo', cmd ? cmd.id : null, now));
      mudancas++;
    }
    for (var off = 0; off < stmts.length; off += 80) await db.batch(stmts.slice(off, off + 80));
    return { iniciados: novos, mudancas: mudancas };
  } catch (e) {
    try { await audit(env, { email: 'sync-agent' }, 'stage_history_erro', 'mirror', null, null, { erro: String(e && e.message || e).slice(0, 300) }, null); } catch (e2) {}
    return { erro: true };
  }
}

function dias(desdeIso, agoraMs) { return Math.max(0, Math.floor((agoraMs - Date.parse(desdeIso)) / 86400000)); }

/* GET /api/stage-history[?dias=7][&card_id=N] — só leitura, qualquer sessão. Sem custo/margem (só etapa e datas).
   tempo na etapa: conta a partir da última MUDANÇA registrada ('kanzo' | 'painel' | 'criacao'). Só 'inicio' = sem dado
   (o card já estava na etapa quando o registro começou; 'observado_desde' dá o mínimo garantido). */
export async function historicoEtapas(env, url) {
  var db = dataDB(env), agoraMs = Date.now();
  var lim = Math.min(Math.max(parseInt(url.searchParams.get('dias') || '7', 10) || 7, 1), 365);
  var desde = await metaGet(env, CHAVE_DESDE);
  var cards = (await db.prepare('SELECT id, title, stage, status FROM cards WHERE deleted_at IS NULL').all()).results || [];
  var hist = (await db.prepare('SELECT card_id, from_stage, to_stage, changed_at, source, command_id FROM stage_history ORDER BY card_id, id').all()).results || [];
  var por = {}; hist.forEach(function (h) { (por[h.card_id] = por[h.card_id] || []).push(h); });
  var out = cards.map(function (c) {
    var hs = por[c.id] || [], ult = hs[hs.length - 1] || null;
    var mud = null; for (var i = hs.length - 1; i >= 0; i--) { if (hs[i].source !== 'inicio') { mud = hs[i]; break; } }
    var mesmaEtapa = mud && (mud.to_stage || null) === (c.stage || null);
    var obs = ult && ult.source === 'inicio' && (ult.to_stage || null) === (c.stage || null) ? ult.changed_at : null;
    return { card_id: c.id, title: c.title, stage: c.stage, stage_label: STAGE_LABEL[c.stage] || c.stage, status: c.status,
      na_etapa_desde: mesmaEtapa ? mud.changed_at : null, dias_na_etapa: mesmaEtapa ? dias(mud.changed_at, agoraMs) : null,
      origem: mesmaEtapa ? mud.source : null, observado_desde: obs, dias_minimo: obs ? dias(obs, agoraMs) : null };
  });
  var abertos = out.filter(function (c) { return c.status !== 'done' && c.stage !== 'old-falhou'; });
  var parados = abertos.filter(function (c) { return (c.dias_na_etapa != null && c.dias_na_etapa >= lim) || (c.dias_na_etapa == null && c.dias_minimo != null && c.dias_minimo >= lim); })
    .map(function (c) { return Object.assign({}, c, { minimo: c.dias_na_etapa == null }); });
  var res = { ok: true, registro_desde: desde || null, dias: lim, gerado_em: iso(), cards: out, parados: parados };
  var cid = parseInt(url.searchParams.get('card_id') || '', 10);
  if (cid > 0) res.historico = (por[cid] || []).map(function (h) { return { from_stage: h.from_stage, to_stage: h.to_stage, changed_at: h.changed_at, source: h.source, command_id: h.command_id }; });
  return json(res);
}
