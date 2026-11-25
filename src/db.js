/* presales-kanzo · src/db.js — Acesso ao D1: bancos, tabela meta, auditoria e fila de comandos (pending_commands). */
'use strict';
import { iso } from './util.js';

export function authDB(env) { return env.AUTH_DB; }

export function dataDB(env) { return env.DATA; }

export async function metaGet(env, key) {
  var r = await dataDB(env).prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}

export async function metaSet(env, key, value) {
  await dataDB(env).prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function audit(env, s, action, entity, entityId, before, after, req) {
  await dataDB(env).prepare('INSERT INTO audit_log (at, actor_email, actor_id, action, entity, entity_id, before_json, after_json, ip) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(iso(), s && s.email || null, s && s.id || null, action, entity, entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      req ? (req.headers.get('CF-Connecting-IP') || '') : '').run();
}

export async function enqueue(env, s, op, entity, entityId, payload) {
  var r = await dataDB(env).prepare('INSERT INTO pending_commands (created_at, status, op, entity, entity_id, payload_json, actor_email) VALUES (?,?,?,?,?,?,?)')
    .bind(iso(), 'pending', op, entity, entityId == null ? null : String(entityId), JSON.stringify(payload || {}), s && s.email || null).run();
  return r.meta && r.meta.last_row_id;
}

/* Lote 1 nuvem: marca card alterado na nuvem para o push do Mac não desfazer. */
export async function markCloudWrite(env, cardId, kind) {
  if (cardId == null || cardId === '') return;
  await dataDB(env).prepare('INSERT INTO cloud_writes (card_id, updated_at, kind) VALUES (?,?,?) ON CONFLICT(card_id) DO UPDATE SET updated_at = excluded.updated_at, kind = excluded.kind')
    .bind(Number(cardId), iso(), String(kind || 'update')).run();
}

export async function clearCloudWrite(env, cardId) {
  if (cardId == null || cardId === '') return;
  await dataDB(env).prepare('DELETE FROM cloud_writes WHERE card_id = ?').bind(Number(cardId)).run();
}

export async function recordSyncConflict(env, cardId, kind, cloudObj, macObj) {
  await dataDB(env).prepare('INSERT INTO sync_conflicts (created_at, card_id, kind, cloud_json, mac_json, resolution, seen) VALUES (?,?,?,?,?,?,0)')
    .bind(iso(), Number(cardId), String(kind || 'card'), cloudObj == null ? null : JSON.stringify(cloudObj), macObj == null ? null : JSON.stringify(macObj), 'cloud_wins').run();
}
