/* presales-kanzo · src/auth.js — Login (senha da Casa só para e-mails da allowlist), sessão, limite por IP, permissão de escrita e token de sync. */
'use strict';
import { ITER, SESSAO_S, JANELA_S, MAX_FALHAS, BLOQ_S, MAX_IP } from './config.js';
import { authDB, dataDB, metaSet } from './db.js';
import { json, cookieSessao, lerCookie, mesmaOrigem, corpoJson } from './http.js';
import { enc, agora, b64, ub64, b64u, hex, aleatorio, sha256, iguais } from './util.js';

export var cacheSessao = new Map();

export async function derivar(senha, salt, iter, pepper) {
  var k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, k, 256);
  var hk = await crypto.subtle.importKey('raw', enc.encode(pepper || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', hk, bits));
}

export async function criarHash(senha, env) { var salt = aleatorio(16); return 'v1$' + ITER + '$' + b64(salt) + '$' + await derivar(senha, salt, ITER, env.PEPPER); }

export async function conferirSenha(senha, guardado, env) {
  var p = String(guardado || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') { await derivar(senha, new Uint8Array(16), ITER, env.PEPPER); return false; }
  return iguais(await derivar(senha, ub64(p[2]), parseInt(p[1], 10) || ITER, env.PEPPER), p[3]);
}

/* Item 3: rotação sem downtime. Aceita SYNC_TOKEN (atual) ou SYNC_TOKEN_NEXT (próximo), comparação em tempo constante.
   Devolve qual vaga casou ('atual' | 'proximo') ou null. Nunca registra nem devolve o valor do token. */
export function syncSlot(req, env) {
  var t = req.headers.get('X-Presales-Sync-Token') || '';
  if (!t) return null;
  var okA = !!env.SYNC_TOKEN && iguais(t, env.SYNC_TOKEN), okN = !!env.SYNC_TOKEN_NEXT && iguais(t, env.SYNC_TOKEN_NEXT);
  return okA ? 'atual' : okN ? 'proximo' : null;
}

export function syncOk(req, env) { return !!syncSlot(req, env); }

export var slotGravado = new WeakMap(); // por banco: só grava no D1 quando a vaga muda

export async function registrarSlot(env, slot) {
  var db = dataDB(env);
  if (!slot || slotGravado.get(db) === slot) return;
  await metaSet(env, 'sync_token_slot', slot); slotGravado.set(db, slot);
}

export function isAdmin(s) { return !!(s && s.papel === 'admin'); }

export function requireWrite(req, s) {
  if (!s) return json({ erro: 'Entre para continuar.', error: 'auth' }, 401);
  if (!isAdmin(s)) return json({ erro: 'Somente o admin pode alterar.', error: 'forbidden' }, 403);
  if (!mesmaOrigem(req) || req.headers.get('X-MCO') !== '1') return json({ erro: 'Origem não permitida.' }, 403);
  return null;
}

export async function sessaoDe(req, env) {
  var tk = lerCookie(req); if (!/^[A-Za-z0-9_-]{40,60}$/.test(tk)) return null;
  var h = await sha256(tk), c = cacheSessao.get(h), t = agora();
  if (c && c.ate > t && c.ver > Date.now() - 60000) return c.u;
  var r = await dataDB(env).prepare('SELECT s.expira_em, s.visto_em, u.id, u.nome, u.email, u.papel, u.ativo FROM presales_sessoes s JOIN presales_users u ON u.id = s.usuario_id WHERE s.id_hash = ?').bind(h).first();
  if (!r || r.expira_em < t || !r.ativo) { cacheSessao.delete(h); return null; }
  if (t - r.visto_em > 3600) await dataDB(env).prepare('UPDATE presales_sessoes SET visto_em = ? WHERE id_hash = ?').bind(t, h).run();
  var u = { id: r.id, nome: r.nome, email: r.email, papel: r.papel, hash: h };
  if (cacheSessao.size > 200) cacheSessao.clear();
  cacheSessao.set(h, { u: u, ate: r.expira_em, ver: Date.now() }); return u;
}

export async function abrirSessao(env, usuarioId, req) {
  var tk = b64u(aleatorio(32)), h = await sha256(tk), t = agora();
  await dataDB(env).prepare('DELETE FROM presales_sessoes WHERE expira_em < ?').bind(t).run();
  await dataDB(env).prepare('INSERT INTO presales_sessoes (id_hash, usuario_id, criada_em, expira_em, visto_em, agente) VALUES (?,?,?,?,?,?)')
    .bind(h, usuarioId, t, t + SESSAO_S, t, (req.headers.get('User-Agent') || '').slice(0, 120)).run();
  return tk;
}

export async function limiteIp(req, env, rota) {
  var ip = req.headers.get('CF-Connecting-IP') || 'x', k = (await sha256('ip|' + ip + '|' + rota)).slice(0, 24), t = agora();
  var r = await dataDB(env).prepare('SELECT n, ini FROM presales_tentativas WHERE chave = ?').bind(k).first();
  if (!r || t - r.ini > JANELA_S) { await dataDB(env).prepare('INSERT OR REPLACE INTO presales_tentativas (chave, n, ini) VALUES (?,1,?)').bind(k, t).run(); return false; }
  await dataDB(env).prepare('UPDATE presales_tentativas SET n = n + 1 WHERE chave = ?').bind(k).run();
  return r.n + 1 > MAX_IP;
}

export async function apiLogin(req, env) {
  if (!mesmaOrigem(req) || req.headers.get('X-MCO') !== '1') return json({ erro: 'Origem não permitida.' }, 403);
  var b = await corpoJson(req); if (!b) return json({ erro: 'Pedido inválido.' }, 400);
  if (await limiteIp(req, env, 'login')) return json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' }, 429);
  var email = String(b.email || '').trim().toLowerCase().slice(0, 120), senha = String(b.senha || '').slice(0, 200), t = agora();
  var u = await dataDB(env).prepare('SELECT * FROM presales_users WHERE email = ?').bind(email).first();
  // timing-safe-ish: always do a hash work
  if (u && u.bloqueado_ate > t) { await derivar(senha, new Uint8Array(16), ITER, env.PEPPER); return json({ erro: 'Conta bloqueada. Tente mais tarde.' }, 429); }
  var ok = false;
  if (u && u.ativo) {
    if (u.senha) ok = await conferirSenha(senha, u.senha, env);
    else if (authDB(env)) {
      var casa = await authDB(env).prepare('SELECT senha, ativo FROM usuarios WHERE email = ?').bind(email).first();
      ok = !!(casa && casa.ativo && await conferirSenha(senha, casa.senha, env));
    } else {
      await derivar(senha, new Uint8Array(16), ITER, env.PEPPER); ok = false;
    }
  } else {
    await derivar(senha, new Uint8Array(16), ITER, env.PEPPER); ok = false;
  }
  if (!u || !ok) {
    if (u) {
      var f = (u.falhas || 0) + 1;
      await dataDB(env).prepare('UPDATE presales_users SET falhas = ?, bloqueado_ate = ? WHERE id = ?')
        .bind(f >= MAX_FALHAS ? 0 : f, f >= MAX_FALHAS ? t + BLOQ_S : 0, u.id).run();
    }
    return json({ erro: 'E-mail ou senha incorretos.' }, 401);
  }
  if (u.falhas) await dataDB(env).prepare('UPDATE presales_users SET falhas = 0, bloqueado_ate = 0 WHERE id = ?').bind(u.id).run();
  var tk = await abrirSessao(env, u.id, req);
  return json({ ok: true, papel: u.papel }, 200, { 'Set-Cookie': cookieSessao(tk, SESSAO_S) });
}

export async function apiLogout(req, env, s) {
  if (!mesmaOrigem(req) || req.headers.get('X-MCO') !== '1') return json({ erro: 'Origem não permitida.' }, 403);
  if (s) { await dataDB(env).prepare('DELETE FROM presales_sessoes WHERE id_hash = ?').bind(s.hash).run(); cacheSessao.delete(s.hash); }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieSessao('', 0) + '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' });
}

