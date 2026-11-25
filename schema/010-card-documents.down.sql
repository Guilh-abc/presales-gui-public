-- DESFAZER a migração 10 (Documentos e links do card). SÓ rode com a versão ANTIGA do app no ar (sem documentos),
-- senão a versão nova recria as tabelas ao abrir. ISTO APAGA os documentos e o histórico: faça backup antes
-- (D1 Time Travel bookmark ou export SQL). A versão antiga do app ignora essas tabelas, então normalmente NÃO é preciso desfazer.
DROP TRIGGER IF EXISTS tg_card_docs_no_delete;
DROP TRIGGER IF EXISTS tg_card_doc_hist_no_delete;
DROP TRIGGER IF EXISTS tg_card_doc_hist_no_update;
DROP INDEX IF EXISTS ix_card_doc_hist_doc;
DROP TABLE IF EXISTS card_document_history;
DROP INDEX IF EXISTS ux_card_docs_url;
DROP INDEX IF EXISTS ix_card_docs_card_tipo;
DROP INDEX IF EXISTS ix_card_docs_card;
DROP TABLE IF EXISTS card_documents;
UPDATE meta SET value = '9' WHERE key = 'schema_version';
