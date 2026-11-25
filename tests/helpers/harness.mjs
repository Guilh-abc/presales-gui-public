// Harness de teste do Worker: D1 simulado com node:sqlite (em memória), sessão de admin/viewer,
// relógio fixo e um quadro real (snapshot do Kanzo) como push do Mac. Não toca produção.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ROOT = new URL('../../', import.meta.url);
export const FIXED_NOW = Date.parse('2026-11-09T15:00:00Z');
const RealDate = globalThis.Date;
export function congelarRelogio(ms = FIXED_NOW) {
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(ms); }
    static now() { return ms; }
  }
  globalThis.Date = FakeDate;
  return () => { globalThis.Date = RealDate; };
}

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))); }
  _p() { return this.db.prepare(this.sql); }
  async first(col) { const r = this._p().get(...this.args); if (!r) return null; const o = { ...r }; return col ? o[col] : o; }
  async all() { return { results: this._p().all(...this.args).map(r => ({ ...r })), success: true }; }
  async run() { const r = this._p().run(...this.args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }
  _runSync() { return this._p().run(...this.args); }
}
export class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { this.db.exec('BEGIN'); try { const out = stmts.map(s => s._runSync()); this.db.exec('COMMIT'); return out.map(() => ({ success: true })); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  exec(sql) { this.db.exec(sql); }
}

export const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
export const ADMIN_TK = 'A'.repeat(43), VIEW_TK = 'V'.repeat(43);
export const SYNC_TOKEN = 'tok-atual-teste', SYNC_TOKEN_NEXT = 'tok-proximo-teste';

export function snapshot() {
  const ctx = {}; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('public/js/dados-kanzo.js', ROOT), 'utf8'), ctx);
  return ctx.KANZO_SNAPSHOT;
}
/* Quadro no formato do push do Mac (kanzo export), montado a partir do snapshot real. */
export function board() {
  const s = snapshot();
  return {
    hostname: 'teste', exported_at: '2026-11-09T14:00:00Z',
    projects: [{ id: 1, slug: 'pre-vendas', name: s.meta.project_name, created_at: '2026-11-06T12:00:00Z', tasks: s.cards.map(c => ({
      id: c.id, key: c.key, title: c.title, description: c.description, status: c.status,
      tags: [c.stage && 'stage:' + c.stage, c.priority && 'prioridade:' + c.priority].concat((c.labels || []).map(l => 'rotulo:' + l)).filter(Boolean).join(','),
      created_at: c.created_at, updated_at: c.updated_at,
      comments: (c.comments || []).map((m, i) => ({ id: c.id * 1000 + i, author: m.author || 'kanzo', body: m.body || '', created_at: m.created_at || c.created_at }))
    })) }]
  };
}

export async function montar(opts = {}) {
  const DATA = new FakeD1(), AUTH = new FakeD1();
  if (!opts.semSchema) DATA.exec(fs.readFileSync(new URL('schema/presales.sql', ROOT), 'utf8'));
  AUTH.exec('CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email TEXT, senha TEXT, ativo INTEGER)');
  // MAC_SYNC '1': os testes antigos exercitam o espelho do Mac. Produção (sem a var) = app como fonte oficial; ver tests/app-fonte.test.mjs.
  const env = { DATA, AUTH_DB: AUTH, PEPPER: 'pepper-teste', SYNC_TOKEN, MAC_SYNC: '1', ...(opts.env || {}) };
  const mod = await import(new URL(opts.entry || 'worker.js', ROOT).href);
  const worker = mod.default;
  await worker.fetch(new Request('https://k.test/api/saude'), env); // cria schema/admin
  DATA.exec("INSERT INTO presales_users (email, nome, papel, ativo) VALUES ('viewer@teste', 'Viewer', 'viewer', 1)");
  const t = Math.floor(Date.now() / 1000);
  DATA.db.prepare('INSERT INTO presales_sessoes (id_hash, usuario_id, criada_em, expira_em, visto_em) VALUES (?,?,?,?,?)').run(sha(ADMIN_TK), 1, t, t + 86400, t);
  DATA.db.prepare('INSERT INTO presales_sessoes (id_hash, usuario_id, criada_em, expira_em, visto_em) VALUES (?,?,?,?,?)').run(sha(VIEW_TK), 2, t, t + 86400, t);
  const ORIG = 'https://k.test';
  const H = {
    admin: { Cookie: '__Host-mco=' + ADMIN_TK, Origin: ORIG, 'X-MCO': '1', 'Content-Type': 'application/json', Accept: 'application/json' },
    viewer: { Cookie: '__Host-mco=' + VIEW_TK, Origin: ORIG, 'X-MCO': '1', 'Content-Type': 'application/json', Accept: 'application/json' },
    sync: { 'X-Presales-Sync-Token': SYNC_TOKEN, 'Content-Type': 'application/json' },
    anon: {}
  };
  async function call(path, { method = 'GET', as = 'admin', headers = {}, body } = {}) {
    const r = await worker.fetch(new Request(ORIG + path, { method, headers: { ...H[as], ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env);
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch (_) {}
    return { status: r.status, headers: r.headers, text: txt, body: json };
  }
  return { env, DATA, worker, call, H };
}
