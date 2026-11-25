
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, key TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo', stage TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
  prioridade TEXT, atrasado INTEGER NOT NULL DEFAULT 0, url TEXT NOT NULL DEFAULT '',
  human INTEGER NOT NULL DEFAULT 0, product_id INTEGER, solution_id INTEGER,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS ix_cards_stage ON cards(stage);
CREATE INDEX IF NOT EXISTS ix_cards_deleted ON cards(deleted_at);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_comments_card ON comments(card_id);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', product_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_email TEXT, actor_id INTEGER,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  before_json TEXT, after_json TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS pending_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|applied|failed|superseded
  op TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL,
  actor_email TEXT,
  result_json TEXT,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_pending_status ON pending_commands(status);
