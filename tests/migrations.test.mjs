// Item 4: schema em migrations idempotentes (src/migrations.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, board, FakeD1 } from './helpers/harness.mjs';
import { MIGRATIONS, SCHEMA_VERSION, migrar, ensureSchema, schemaVersion } from '../src/migrations.js';

const tabelas = (db) => db.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);

test('banco vazio: as migrations criam tudo e o Worker funciona (push + leitura)', async () => {
  const h = await montar({ semSchema: true });
  for (const t of ['meta', 'projects', 'cards', 'comments', 'products', 'solutions', 'audit_log', 'pending_commands', 'presales_users', 'presales_sessoes', 'presales_tentativas', 'card_id_map'])
    assert.ok(tabelas(h.DATA).includes(t), t);
  assert.equal(await schemaVersion(h.env), SCHEMA_VERSION);
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() })).body.cards, 55);
  assert.equal((await h.call('/api/cards')).body.total, 55);
});

test('idempotente: rodar de novo não muda nada nem apaga dados', async () => {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  const antes = tabelas(h.DATA), n = h.DATA.db.prepare('SELECT COUNT(*) n FROM cards').get().n;
  h.DATA.exec("DELETE FROM meta WHERE key = 'schema_version'"); // como o D1 de produção hoje (sem versão)
  assert.deepEqual(await migrar(h.env), MIGRATIONS.map(m => m.id), 'reaplica todas, sem erro');
  assert.deepEqual(await migrar(h.env), [], 'já está na última versão');
  assert.deepEqual(tabelas(h.DATA), antes);
  assert.equal(h.DATA.db.prepare('SELECT COUNT(*) n FROM cards').get().n, n);
  assert.equal(h.DATA.db.prepare("SELECT papel FROM presales_users WHERE email = 'admin@exemplo.com'").get().papel, 'admin');
});

test('roda uma vez por banco no isolate (antes: a cada requisição)', async () => {
  const DATA = new FakeD1(); let n = 0; const orig = DATA.prepare.bind(DATA);
  DATA.prepare = (sql) => { if (/CREATE TABLE/.test(sql)) n++; return orig(sql); };
  const env = { DATA };
  await ensureSchema(env); const depois1 = n; await ensureSchema(env); await ensureSchema({ DATA });
  assert.ok(depois1 > 0); assert.equal(n, depois1);
});

test('migration 1 cobre exatamente schema/presales.sql e todas usam IF NOT EXISTS', () => {
  const sql = fs.readFileSync(new URL('../schema/presales.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  const esperado = sql.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(MIGRATIONS[0].sql, esperado);
  for (const m of MIGRATIONS) for (const s of m.sql) assert.match(s, /^CREATE (TABLE|UNIQUE INDEX|INDEX|TRIGGER) IF NOT EXISTS /);
  assert.deepEqual(MIGRATIONS.map(m => m.id), MIGRATIONS.map((_, i) => i + 1), 'ids em sequência');
});
