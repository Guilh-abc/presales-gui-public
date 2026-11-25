-- Migração 10 (18/11/2026): Documentos e links do card. Igual ao que src/migrations.js aplica sozinho (só ADICIONA).
-- Só para conferência/operação manual; o app aplica a migração ao abrir (ensureSchema).
CREATE TABLE IF NOT EXISTS card_documents ( id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, title TEXT NOT NULL, doc_type TEXT NOT NULL, url TEXT NOT NULL, url_norm TEXT NOT NULL, version TEXT, note TEXT, parent_id INTEGER, responsible TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, removed_by TEXT, removed_at TEXT, removal_reason TEXT );
CREATE INDEX IF NOT EXISTS ix_card_docs_card ON card_documents(card_id);
CREATE INDEX IF NOT EXISTS ix_card_docs_card_tipo ON card_documents(card_id, doc_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_card_docs_url ON card_documents(card_id, url_norm) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS card_document_history ( id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, card_id INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, by_user TEXT NOT NULL, before_json TEXT, after_json TEXT, changes_json TEXT, reason TEXT );
CREATE INDEX IF NOT EXISTS ix_card_doc_hist_doc ON card_document_history(doc_id, id);
CREATE TRIGGER IF NOT EXISTS tg_card_doc_hist_no_update BEFORE UPDATE ON card_document_history BEGIN SELECT RAISE(ABORT, 'card_document_history e somente de inclusao'); END;
CREATE TRIGGER IF NOT EXISTS tg_card_doc_hist_no_delete BEFORE DELETE ON card_document_history BEGIN SELECT RAISE(ABORT, 'card_document_history e somente de inclusao'); END;
CREATE TRIGGER IF NOT EXISTS tg_card_docs_no_delete BEFORE DELETE ON card_documents BEGIN SELECT RAISE(ABORT, 'card_documents: remocao so logica (removed_at)'); END;
INSERT INTO meta (key, value) VALUES ('schema_version', '10') ON CONFLICT(key) DO UPDATE SET value = excluded.value;
