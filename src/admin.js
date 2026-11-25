/* presales-kanzo · src/admin.js — Gestão da allowlist (máx. 4 acessos, só o admin). */
'use strict';
import { criarHash, isAdmin } from './auth.js';
import { MAX_USERS, ADMIN_EMAIL } from './config.js';
import { dataDB, audit } from './db.js';
import { json, mesmaOrigem } from './http.js';
import { agora } from './util.js';

export async function adminUsers(env, s, req, method, id, b) {
  if (!isAdmin(s)) return json({ erro: 'Somente admin.', error: 'forbidden' }, 403);
  if (method === 'GET') {
    var r = await dataDB(env).prepare('SELECT id, email, nome, papel, ativo, senha IS NOT NULL AS senha_local, criado_em FROM presales_users ORDER BY id').all();
    var n = await dataDB(env).prepare('SELECT COUNT(*) AS n FROM presales_users WHERE ativo = 1').first();
    return json({ users: r.results || [], active: (n && n.n) || 0, max: MAX_USERS });
  }
  if (method === 'POST') {
    if (!mesmaOrigem(req) || req.headers.get('X-MCO') !== '1') return json({ erro: 'Origem não permitida.' }, 403);
    var email = String(b.email || '').trim().toLowerCase();
    var nome = String(b.nome || email.split('@')[0] || 'User').slice(0, 80);
    if (!email || email.indexOf('@') < 0) return json({ erro: 'E-mail inválido.' }, 400);
    if (email === ADMIN_EMAIL) return json({ erro: 'Admin já existe.' }, 400);
    var n = await dataDB(env).prepare('SELECT COUNT(*) AS n FROM presales_users WHERE ativo = 1').first();
    if ((n && n.n) >= MAX_USERS) return json({ erro: 'Máximo de ' + MAX_USERS + ' acessos.', error: 'max_users' }, 400);
    var exists = await dataDB(env).prepare('SELECT id, ativo FROM presales_users WHERE email = ?').bind(email).first();
    var t = agora();
    var localHash = null;
    if (b.senha) localHash = await criarHash(String(b.senha), env);
    if (exists) {
      await dataDB(env).prepare('UPDATE presales_users SET nome = ?, papel = ?, ativo = 1, senha = COALESCE(?, senha), atualizado_em = ? WHERE id = ?')
        .bind(nome, 'viewer', localHash, t, exists.id).run();
      await audit(env, s, 'reactivate', 'user', exists.id, exists, { email: email }, req);
      return json({ ok: true, user: await dataDB(env).prepare('SELECT id, email, nome, papel, ativo FROM presales_users WHERE id = ?').bind(exists.id).first() });
    }
    var ins = await dataDB(env).prepare('INSERT INTO presales_users (email, nome, papel, ativo, senha, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)')
      .bind(email, nome, 'viewer', 1, localHash, t, t).run();
    var uid = ins.meta && ins.meta.last_row_id;
    await audit(env, s, 'create', 'user', uid, null, { email: email, papel: 'viewer' }, req);
    return json({ ok: true, user: { id: uid, email: email, nome: nome, papel: 'viewer', ativo: 1 } });
  }
  if (method === 'DELETE') {
    if (!mesmaOrigem(req) || req.headers.get('X-MCO') !== '1') return json({ erro: 'Origem não permitida.' }, 403);
    var u = await dataDB(env).prepare('SELECT * FROM presales_users WHERE id = ?').bind(id).first();
    if (!u) return json({ erro: 'Não encontrado' }, 404);
    if (u.email === ADMIN_EMAIL) return json({ erro: 'Não é possível remover o admin.' }, 400);
    await dataDB(env).prepare('UPDATE presales_users SET ativo = 0, atualizado_em = ? WHERE id = ?').bind(agora(), id).run();
    await dataDB(env).prepare('DELETE FROM presales_sessoes WHERE usuario_id = ?').bind(id).run();
    await audit(env, s, 'deactivate', 'user', id, u, null, req);
    return json({ ok: true });
  }
  return json({ erro: 'Método' }, 405);
}

