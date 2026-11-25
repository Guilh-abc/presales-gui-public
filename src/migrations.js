/* presales-kanzo · src/migrations.js — schema em migrations idempotentes (CREATE ... IF NOT EXISTS).
   Rodam uma vez por isolate: lê meta.schema_version e aplica só as que faltam (todas podem rodar de novo sem efeito).
   Nunca toca o D1 da Casa em Ordem (AUTH_DB). Para mudar o schema: ADICIONAR uma migration nova no fim, nunca editar uma antiga. */
'use strict';
import { ADMIN_EMAIL } from './config.js';
import { dataDB, metaSet } from './db.js';
import { agora } from './util.js';

export var MIGRATIONS = [
  { id: 1, nome: 'espelho do Kanzo (schema/presales.sql)', sql: [
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS projects ( id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT, updated_at TEXT, deleted_at TEXT )',
      'CREATE TABLE IF NOT EXISTS cards ( id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'todo\', stage TEXT, tags_json TEXT NOT NULL DEFAULT \'[]\', prioridade TEXT, atrasado INTEGER NOT NULL DEFAULT 0, url TEXT NOT NULL DEFAULT \'\', human INTEGER NOT NULL DEFAULT 0, product_id INTEGER, solution_id INTEGER, pending INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_cards_status ON cards(status)',
      'CREATE INDEX IF NOT EXISTS ix_cards_stage ON cards(stage)',
      'CREATE INDEX IF NOT EXISTS ix_cards_deleted ON cards(deleted_at)',
      'CREATE TABLE IF NOT EXISTS comments ( id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_comments_card ON comments(card_id)',
      'CREATE TABLE IF NOT EXISTS products ( id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT, deleted_at TEXT )',
      'CREATE TABLE IF NOT EXISTS solutions ( id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', product_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT, deleted_at TEXT )',
      'CREATE TABLE IF NOT EXISTS audit_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_email TEXT, actor_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT, ip TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at)',
      'CREATE TABLE IF NOT EXISTS pending_commands ( id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', op TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, actor_email TEXT, result_json TEXT, applied_at TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_pending_status ON pending_commands(status)'
  ] },
  { id: 2, nome: 'acesso: allowlist, sessões e tentativas', sql: [
      'CREATE TABLE IF NOT EXISTS presales_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, nome TEXT NOT NULL, papel TEXT NOT NULL DEFAULT \'viewer\', ativo INTEGER NOT NULL DEFAULT 1, senha TEXT, falhas INTEGER NOT NULL DEFAULT 0, bloqueado_ate INTEGER NOT NULL DEFAULT 0, criado_em INTEGER, atualizado_em INTEGER)',
      'CREATE TABLE IF NOT EXISTS presales_sessoes (id_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criada_em INTEGER NOT NULL, expira_em INTEGER NOT NULL, visto_em INTEGER NOT NULL, agente TEXT)',
      'CREATE TABLE IF NOT EXISTS presales_tentativas (chave TEXT PRIMARY KEY, n INTEGER NOT NULL, ini INTEGER NOT NULL)'
  ] },
  { id: 3, nome: 'mapa id temporário da nuvem → id real do Mac', sql: [
      'CREATE TABLE IF NOT EXISTS card_id_map (temp_id INTEGER PRIMARY KEY, real_id INTEGER NOT NULL, real_key TEXT NOT NULL, created_at TEXT NOT NULL)'
  ] },
  /* Feature 6 (registro rápido). Se outro lote criar uma migration 4 antes, renumere esta para a próxima livre. */
  { id: 4, nome: 'registro rápido: histórico quick_entries', sql: [
      'CREATE TABLE IF NOT EXISTS quick_entries ( id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, actor_email TEXT NOT NULL, raw_text TEXT NOT NULL, card_id INTEGER, proposal_json TEXT NOT NULL, command_ids_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\' )',
      'CREATE INDEX IF NOT EXISTS ix_quick_entries_card ON quick_entries(card_id)'
  ] },
  /* Item 1 (09/11): histórico de etapa. Só registra daqui para frente (ver src/etapas.js); nada do passado é inventado. */
  { id: 5, nome: 'histórico de etapa stage_history', sql: [
      'CREATE TABLE IF NOT EXISTS stage_history ( id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, from_stage TEXT, to_stage TEXT, changed_at TEXT NOT NULL, source TEXT NOT NULL, command_id INTEGER, recorded_at TEXT NOT NULL )',
      'CREATE INDEX IF NOT EXISTS ix_stage_history_card ON stage_history(card_id, id)'
  ] },
  /* Migração nuvem lote 1 (09/11): D1 = fonte oficial. cloud_writes marca o que o painel/rápido gravou; sync_conflicts registra quando o Mac divergiu e a nuvem venceu. */
  { id: 6, nome: 'nuvem fonte oficial: cloud_writes + sync_conflicts', sql: [
      'CREATE TABLE IF NOT EXISTS cloud_writes ( card_id INTEGER PRIMARY KEY, updated_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT \'update\' )',
      'CREATE TABLE IF NOT EXISTS sync_conflicts ( id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, card_id INTEGER NOT NULL, kind TEXT NOT NULL, cloud_json TEXT, mac_json TEXT, resolution TEXT NOT NULL DEFAULT \'cloud_wins\', seen INTEGER NOT NULL DEFAULT 0 )',
      'CREATE INDEX IF NOT EXISTS ix_sync_conflicts_card ON sync_conflicts(card_id)',
      'CREATE INDEX IF NOT EXISTS ix_sync_conflicts_seen ON sync_conflicts(seen, id)'
  ] },
  /* Remodelo 11/11/2026: tarefas dentro do card (estilo Planner). source = 'user' (tarefa livre) ou 'suggestion' (sugestão da etapa,
     sugg_key do seed em kanzo-core.js; uma linha por card+sugg_key, garantido no código). Nunca entra custo/margem aqui.
     ATENÇÃO: o Lote 4 (backup_runs) e o patch do Kiro (checklist/report_cache/card_outcomes) também pediam o id 7, mas NÃO foram
     aplicados. Se forem aplicados depois, renumere-os para 8+ (nunca reusar um id já publicado). */
  { id: 7, nome: 'tarefas do card (card_tasks)', sql: [
      'CREATE TABLE IF NOT EXISTS card_tasks ( id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, source TEXT NOT NULL DEFAULT \'user\', sugg_key TEXT, stage TEXT, dismissed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_card_tasks_card ON card_tasks(card_id, deleted_at)',
      'CREATE INDEX IF NOT EXISTS ix_card_tasks_due ON card_tasks(done, dismissed, due_date)'
  ] },
  /* 12/11/2026: alertas de prazo e relatório diário (src/alertas.js). Só ADICIONA tabelas (idempotente, sem ALTER):
     task_times = marca real de início da tarefa (gravada daqui para frente; tarefas antigas sem linha = "sem registro de tempo");
     alert_runs = log de cada execução do cron. */
  { id: 8, nome: 'alertas: task_times + alert_runs', sql: [
      'CREATE TABLE IF NOT EXISTS task_times ( task_id INTEGER PRIMARY KEY, started_at TEXT NOT NULL )',
      'CREATE TABLE IF NOT EXISTS alert_runs ( id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT NOT NULL, day_sp TEXT NOT NULL, kind TEXT NOT NULL, app_opened INTEGER NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 0, email_status TEXT NOT NULL, detail_json TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_alert_runs_day ON alert_runs(day_sp, id)'
  ] },
  /* 12/11/2026: chave de API do OpenCode (src/apikey.js). Só o sha256 da chave fica aqui; api_key_rate = janela de 60 s por chave.
     ATENÇÃO na junção com o remodelo visual: se ele também criar uma migração 9, renumere esta para a próxima livre. */
  { id: 9, nome: 'chave de API do OpenCode: api_keys + api_key_rate', sql: [
      'CREATE TABLE IF NOT EXISTS api_keys ( id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, prefixo TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, criada_em TEXT NOT NULL, criada_por TEXT, revogada_em TEXT, ultimo_uso_em TEXT )',
      'CREATE TABLE IF NOT EXISTS api_key_rate ( key_id INTEGER PRIMARY KEY, ini INTEGER NOT NULL, n INTEGER NOT NULL )'
  ] },
  /* 18/11/2026: "Documentos e links" do card (src/documentos.js). SÓ ADICIONA (idempotente, sem ALTER). Só links, nada de arquivo.
     card_documents: remoção sempre lógica (removed_*), duplicata barrada por índice único parcial (card_id, url_norm) entre os não removidos.
     card_document_history: só inclui. Triggers impedem UPDATE/DELETE do histórico e DELETE físico de documento.
     Desfazer (down): schema/010-card-documents.down.sql. A versão antiga do app ignora essas tabelas. */
  { id: 10, nome: 'documentos e links do card: card_documents + card_document_history', sql: [
      'CREATE TABLE IF NOT EXISTS card_documents ( id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, title TEXT NOT NULL, doc_type TEXT NOT NULL, url TEXT NOT NULL, url_norm TEXT NOT NULL, version TEXT, note TEXT, parent_id INTEGER, responsible TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, removed_by TEXT, removed_at TEXT, removal_reason TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_card_docs_card ON card_documents(card_id)',
      'CREATE INDEX IF NOT EXISTS ix_card_docs_card_tipo ON card_documents(card_id, doc_type)',
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_card_docs_url ON card_documents(card_id, url_norm) WHERE removed_at IS NULL',
      'CREATE TABLE IF NOT EXISTS card_document_history ( id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, card_id INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, by_user TEXT NOT NULL, before_json TEXT, after_json TEXT, changes_json TEXT, reason TEXT )',
      'CREATE INDEX IF NOT EXISTS ix_card_doc_hist_doc ON card_document_history(doc_id, id)',
      "CREATE TRIGGER IF NOT EXISTS tg_card_doc_hist_no_update BEFORE UPDATE ON card_document_history BEGIN SELECT RAISE(ABORT, 'card_document_history e somente de inclusao'); END",
      "CREATE TRIGGER IF NOT EXISTS tg_card_doc_hist_no_delete BEFORE DELETE ON card_document_history BEGIN SELECT RAISE(ABORT, 'card_document_history e somente de inclusao'); END",
      "CREATE TRIGGER IF NOT EXISTS tg_card_docs_no_delete BEFORE DELETE ON card_documents BEGIN SELECT RAISE(ABORT, 'card_documents: remocao so logica (removed_at)'); END"
  ] }
];
export var SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

var prontos = new WeakMap(); // por banco D1, dentro do isolate

export async function schemaVersion(env) {
  try {
    var r = await dataDB(env).prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    return r ? parseInt(r.value, 10) || 0 : 0;
  } catch (e) { return 0; } // sem tabela meta = banco novo
}

export async function migrar(env) {
  var db = dataDB(env), atual = await schemaVersion(env), aplicadas = [];
  for (var i = 0; i < MIGRATIONS.length; i++) {
    var m = MIGRATIONS[i];
    if (m.id <= atual) continue;
    await db.batch(m.sql.map(function (s) { return db.prepare(s); }));
    aplicadas.push(m.id);
  }
  if (aplicadas.length) await metaSet(env, 'schema_version', String(SCHEMA_VERSION));
  return aplicadas;
}

/* Admin fixo (Guilherme) sempre presente e ativo. */
async function garantirAdmin(env) {
  var db = dataDB(env);
  var adm = await db.prepare('SELECT id FROM presales_users WHERE email = ?').bind(ADMIN_EMAIL).first();
  if (!adm) {
    var t = agora();
    await db.prepare('INSERT INTO presales_users (email, nome, papel, ativo, senha, criado_em, atualizado_em) VALUES (?,?,?,?,NULL,?,?)')
      .bind(ADMIN_EMAIL, 'Guilherme', 'admin', 1, t, t).run();
  } else {
    await db.prepare('UPDATE presales_users SET papel = ?, ativo = 1 WHERE email = ?').bind('admin', ADMIN_EMAIL).run();
  }
}

export async function ensureSchema(env) {
  var db = dataDB(env);
  if (prontos.get(db)) return;
  await migrar(env);
  await garantirAdmin(env);
  prontos.set(db, true);
}
