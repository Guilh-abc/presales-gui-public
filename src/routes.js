/* presales-kanzo · src/routes.js — Roteador: mesma API de antes, só reorganizada em módulos. */
'use strict';
import { adminUsers } from './admin.js';
import { isAdmin, requireWrite, sessaoDe, apiLogin, apiLogout } from './auth.js';
import { getSummary, listCards, getCard, auditCard, createCardOnline, patchCardOnline, deleteCardOnline, addCommentOnline, getStages } from './cards.js';
import { dataDB } from './db.js';
import { seguranca, json, html, js, css, redirecionar, corpoJson } from './http.js';
import { ensureSchema } from './migrations.js';
import { PG_LOGIN, JS_LOGIN, PG_ADMIN, JS_ADMIN, CSS_LOGIN, CSS_ADMIN } from './pages.js';
import { syncStatus, handleSync } from './sync.js';
import { historicoEtapas } from './etapas.js';
import { rascunhoCard } from './rascunho.js';
import { confirmarRapido, historicoRapido, desfazerRapido } from './rapido.js';
import { snapshotLeitura } from './leitura.js';
import { listarTarefas, criarTarefa, editarTarefa, excluirTarefa } from './tarefas.js';
import { listarDocs, contarDocs, criarDoc, editarDoc, removerDoc, historicoDoc } from './documentos.js';
import { macSyncLigado } from './config.js';
import { apiAlertas, coletar, relatorioHtml, rodarCron } from './alertas.js';
import { temBearer, rotaAgente, adminChaves } from './apikey.js';

export default {
  async fetch(req, env) {
    try {
      await ensureSchema(env);
      var url = new URL(req.url), p = url.pathname, method = req.method;
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return redirecionar('https://' + url.host + p + url.search, 301);

      if (p === '/api/saude' || p === '/api/health') return json({ ok: true, servico: 'presales-kanzo', version: 3, source: 'd1', app_only: !macSyncLigado(env), features: ['expect_sha256', 'audit', 'keep_pending', 'tasks', 'docs'] });

      /* Remodelo 11/11: o app é a fonte oficial. Sem MAC_SYNC = "1", o agente do Mac não lê nem escreve nada (protege o D1 de um push antigo). */
      if (p.indexOf('/sync/') === 0) {
        if (!macSyncLigado(env)) return json({ erro: 'Sincronização com o Kanzo do Mac desligada: o app é a fonte oficial.', error: 'sync_desligado' }, 410);
        return await handleSync(req, env, p, method);
      }

      /* 12/11: OpenCode (máquina). Com "Authorization: Bearer" vale SÓ a chave (o cookie é ignorado): escopo fechado em src/apikey.js. */
      if (temBearer(req)) return await rotaAgente(req, env, url);

      var s = await sessaoDe(req, env);
      if (p === '/login') return s ? redirecionar('/') : html(PG_LOGIN);
      if (p === '/portal/login.js') return js(JS_LOGIN);
      if (p === '/portal/admin.js') return js(JS_ADMIN);
      if (p === '/portal/login.css') return css(CSS_LOGIN);
      if (p === '/portal/admin.css') return css(CSS_ADMIN);
      if (p === '/api/login' && method === 'POST') return await apiLogin(req, env);
      if (p === '/api/logout' && method === 'POST') return await apiLogout(req, env, s);

      if (!s) {
        var nav = req.headers.get('Sec-Fetch-Mode') === 'navigate' || /text\/html/.test(req.headers.get('Accept') || '');
        if (nav && method === 'GET' && p.indexOf('/api/') !== 0) return redirecionar('/login');
        return json({ erro: 'Entre para continuar.', error: 'auth' }, 401);
      }

      if (p === '/admin') return isAdmin(s) ? html(PG_ADMIN) : redirecionar('/');
      if (p === '/api/me') return json({ id: s.id, nome: s.nome, email: s.email, papel: s.papel, can_write: isAdmin(s) });
      if (p === '/api/sync/status') return json(await syncStatus(env));
      // Feature 6: registro rápido pelo celular. Só admin; escrita com a mesma trava de origem/X-MCO do editor.
      if (p === '/rapido') return redirecionar('/rapido.html');
      if (p === '/api/rapido/confirm' && method === 'POST') {
        var gR = requireWrite(req, s); if (gR) return gR;
        var bR = await corpoJson(req); if (!bR) return json({ erro: 'JSON inválido' }, 400);
        return await confirmarRapido(env, s, bR, req);
      }
      if (p === '/api/rapido/history' && method === 'GET') {
        if (!isAdmin(s)) return json({ erro: 'Somente o admin.', error: 'forbidden' }, 403);
        return await historicoRapido(env, url);
      }
      var mRU = p.match(/^\/api\/rapido\/(\d+)\/undo$/);
      if (mRU && method === 'POST') {
        var gU = requireWrite(req, s); if (gU) return gU;
        return await desfazerRapido(env, s, parseInt(mRU[1], 10), req);
      }

      if (p === '/api/stage-history' && method === 'GET') return await historicoEtapas(env, url);
      if (p === '/api/summary' && method === 'GET') return json(await getSummary(env, url));
      if (p === '/api/stages' && method === 'GET') return json(await getStages(env));

      if (p === '/api/admin/users' || /^\/api\/admin\/users\/\d+$/.test(p)) {
        var mid = p.match(/^\/api\/admin\/users\/(\d+)$/);
        var bodyA = method === 'GET' ? null : (await corpoJson(req) || {});
        return await adminUsers(env, s, req, method, mid ? parseInt(mid[1], 10) : null, bodyA);
      }

      // 12/11: chaves do OpenCode (só o admin, pela sessão; criar/revogar com a mesma trava de origem do editor).
      var mKey = p.match(/^\/api\/admin\/api-keys(?:\/(\d+)\/(revoke))?$/);
      if (mKey) {
        if (!isAdmin(s)) return json({ erro: 'Somente o admin.', error: 'forbidden' }, 403);
        if (method !== 'GET') { var gK = requireWrite(req, s); if (gK) return gK; }
        return await adminChaves(env, s, req, method, mKey[1] ? parseInt(mKey[1], 10) : null, mKey[2] || null, method === 'POST' ? (await corpoJson(req) || {}) : null);
      }

      if (p === '/api/cards' && method === 'GET') return json(await listCards(env, url, !isAdmin(s)));
      if (p === '/api/cards' && method === 'POST') {
        var gate = requireWrite(req, s); if (gate) return gate;
        var bc = await corpoJson(req); if (!bc) return json({ erro: 'JSON inválido' }, 400);
        return await createCardOnline(env, s, bc, req);
      }
      var mCard = p.match(/^\/api\/cards\/(\d+)$/);
      if (mCard) {
        var cid = parseInt(mCard[1], 10);
        if (method === 'GET') { var card = await getCard(env, cid, !isAdmin(s)); return card ? json(card) : json({ erro: 'Não encontrado' }, 404); }
        var g2 = requireWrite(req, s); if (g2) return g2;
        if (method === 'PATCH') { var bp = await corpoJson(req); if (!bp) return json({ erro: 'JSON inválido' }, 400); return await patchCardOnline(env, s, cid, bp, req); }
        if (method === 'DELETE') return await deleteCardOnline(env, s, cid, req);
      }
      // Item 4: rascunho de pricing / esqueleto de proposta a partir do card. Só admin; não grava nada.
      var mRas = p.match(/^\/api\/cards\/(\d+)\/rascunho$/);
      if (mRas && method === 'GET') {
        if (!isAdmin(s)) return json({ erro: 'Somente o admin.', error: 'forbidden' }, 403);
        return await rascunhoCard(env, parseInt(mRas[1], 10), url);
      }
      var mAud = p.match(/^\/api\/cards\/(\d+)\/audit$/);
      if (mAud && method === 'GET') return json(await auditCard(env, parseInt(mAud[1], 10), !isAdmin(s)));
      var mCom = p.match(/^\/api\/cards\/(\d+)\/comments$/);
      if (mCom && method === 'POST') {
        var g3 = requireWrite(req, s); if (g3) return g3;
        var bcom = await corpoJson(req); if (!bcom) return json({ erro: 'JSON inválido' }, 400);
        return await addCommentOnline(env, s, parseInt(mCom[1], 10), bcom, req);
      }
      // Remodelo 11/11: tarefas do card (migração 7). Leitura: qualquer sessão (perfil leitura sem custo/margem). Escrita: só admin.
      if (p === '/api/tasks' && method === 'GET') return json(await listarTarefas(env, url, !isAdmin(s)));
      var mTk = p.match(/^\/api\/cards\/(\d+)\/tasks$/);
      if (mTk && method === 'GET') { url.searchParams.set('card_id', mTk[1]); return json(await listarTarefas(env, url, !isAdmin(s))); }
      if (mTk && method === 'POST') {
        var gT = requireWrite(req, s); if (gT) return gT;
        var bT = await corpoJson(req); if (!bT) return json({ erro: 'JSON inválido' }, 400);
        return await criarTarefa(env, s, parseInt(mTk[1], 10), bT, req);
      }
      var mTid = p.match(/^\/api\/tasks\/(\d+)$/);
      if (mTid && (method === 'PATCH' || method === 'DELETE')) {
        var gT2 = requireWrite(req, s); if (gT2) return gT2;
        if (method === 'DELETE') return await excluirTarefa(env, s, parseInt(mTid[1], 10), req);
        var bT2 = await corpoJson(req); if (!bT2) return json({ erro: 'JSON inválido' }, 400);
        return await editarTarefa(env, s, parseInt(mTid[1], 10), bT2, req);
      }
      // 18/11: Documentos e links do card (migração 10). SÓ links; o servidor nunca busca a URL. Leitura: qualquer sessão. Escrita: só admin (requireWrite).
      // Histórico completo e itens removidos: só admin. O perfil leitura vê título/observação sem custo/margem.
      if (p === '/api/docs/counts' && method === 'GET') return await contarDocs(env);
      var mDc = p.match(/^\/api\/cards\/(\d+)\/docs$/);
      if (mDc && method === 'GET') return await listarDocs(env, parseInt(mDc[1], 10), { leitura: !isAdmin(s), admin: isAdmin(s) });
      if (mDc && method === 'POST') {
        var gD = requireWrite(req, s); if (gD) return gD;
        var bD = await corpoJson(req); if (!bD) return json({ erro: 'JSON inválido' }, 400);
        return await criarDoc(env, s, parseInt(mDc[1], 10), bD, req);
      }
      var mDi = p.match(/^\/api\/docs\/(\d+)$/);
      if (mDi && method === 'PATCH') {
        var gD2 = requireWrite(req, s); if (gD2) return gD2;
        var bD2 = await corpoJson(req); if (!bD2) return json({ erro: 'JSON inválido' }, 400);
        return await editarDoc(env, s, parseInt(mDi[1], 10), bD2, req);
      }
      var mDr = p.match(/^\/api\/docs\/(\d+)\/remove$/);
      if (mDr && method === 'POST') {
        var gD3 = requireWrite(req, s); if (gD3) return gD3;
        var bD3 = await corpoJson(req); if (!bD3) return json({ erro: 'JSON inválido' }, 400);
        return await removerDoc(env, s, parseInt(mDr[1], 10), bD3, req);
      }
      var mDh = p.match(/^\/api\/docs\/(\d+)\/history$/);
      if (mDh && method === 'GET') {
        if (!isAdmin(s)) return json({ erro: 'Somente o admin vê o histórico completo.', error: 'forbidden' }, 403);
        return await historicoDoc(env, parseInt(mDh[1], 10));
      }
      // 12/11: avisos de prazo ao abrir o app e prévia do relatório diário. Só admin (os prazos são do Guilherme). Não escrevem em cards/tarefas.
      if (p === '/api/alertas' && method === 'GET') {
        if (!isAdmin(s)) return json({ avisos: [], itens: [], admin: false }); // leitura: nada (sem 403 para não sujar o console do painel)
        var agoraQ = url.searchParams.get('agora'), agoraMs = agoraQ ? Date.parse(agoraQ) : undefined;
        if (agoraMs !== undefined && !isFinite(agoraMs)) agoraMs = undefined;
        return json(await apiAlertas(env, s, agoraMs));
      }
      if (p === '/api/relatorio' && method === 'GET') {
        if (!isAdmin(s)) return json({ erro: 'Somente o admin.', error: 'forbidden' }, 403);
        return html(relatorioHtml(await coletar(env), url.origin));
      }
      // products/solutions stay admin-write, anyone-read
      if (p === '/api/products' && method === 'GET') {
        var pr = await dataDB(env).prepare('SELECT * FROM products WHERE deleted_at IS NULL AND active = 1 ORDER BY name').all();
        return json({ products: pr.results || [] });
      }
      if (p === '/api/solutions' && method === 'GET') {
        var so = await dataDB(env).prepare('SELECT * FROM solutions WHERE deleted_at IS NULL AND active = 1 ORDER BY name').all();
        return json({ solutions: so.results || [] });
      }

      if (method === 'GET' || method === 'HEAD') {
        // Perfil leitura: o snapshot de fallback também sai sem custo/margem (senão bastaria abrir /js/dados-kanzo.js).
        if (p === '/js/dados-kanzo.js' && !isAdmin(s) && env.ASSETS && env.ASSETS.fetch) return await snapshotLeitura(env, req);
        if (env.ASSETS && env.ASSETS.fetch) {
          var a = await env.ASSETS.fetch(req);
          if (a.status !== 404) {
            var h = seguranca(new Headers(a.headers), 'ativo');
            // Lote 8: fonte local é imutável (história de versionamento no caminho); cache longo só no .woff2.
            if (/^\/fonts\/.+\.woff2$/.test(p)) h.set('Cache-Control', 'private, max-age=2592000');
            return new Response(a.body, { status: a.status, headers: h });
          }
        }
        return json({ erro: 'Não encontrado' }, 404);
      }
      return json({ erro: 'Método não permitido' }, 405);
    } catch (e) {
      return json({ erro: 'Erro interno', detalhe: String(e && e.message || e) }, 500);
    }
  },
  /* 12/11: Cron Trigger "0 21 * * 1-5" (18:00 em Brasília, dias úteis): relatório diário por e-mail se o app não foi aberto no dia. */
  async scheduled(ev, env, ctx) {
    await ensureSchema(env);
    await rodarCron(env, { agora: ev && ev.scheduledTime, kind: 'cron' });
  }
};

