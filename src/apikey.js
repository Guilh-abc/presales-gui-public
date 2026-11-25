/* presales-kanzo · src/apikey.js — Acesso de máquina para o OpenCode (12/11/2026, pedido do Guilherme).
   Autenticação: "Authorization: Bearer kzo_<43 chars>". A chave NUNCA é guardada: só o sha256 dela em api_keys (migração 9).
   Escopo fechado (allowlist abaixo), sempre como perfil de LEITURA (sem custo/margem) e sem exclusão:
     pode: listar/ler cards e tarefas, criar card, editar etapa/status/saúde/prazo/situação/próxima ação/responsáveis/solução,
           criar/editar/concluir tarefa, comentar.
     não pode: excluir nada, ler ou gravar custo/margem/pricing interno, editar a descrição livre, TCV/MRC/OTC, admin, sync.
   Toda escrita reaproveita os handlers do painel (createCardOnline, patchCardOnline, addCommentOnline, criarTarefa, editarTarefa)
   e fica no histórico do card com autor "via OpenCode". Limite: API_RATE_MAX pedidos por minuto por chave (padrão 120);
   chave inválida conta no limite por IP (20 em 15 min). Revogar: POST /api/admin/api-keys/:id/revoke (sessão admin) ou SQL. */
'use strict';
import { K } from './format.js'; // carrega kanzo-core.js antes de format.js/fields.js do painel
import '../public/js/format.js';
import '../public/js/fields.js';
import { STAGE_ORDER, STAGE_LABEL, JANELA_S, MAX_IP } from './config.js';
import { dataDB, audit } from './db.js';
import { json, corpoJson } from './http.js';
import { getCard, listCards, auditCard, createCardOnline, patchCardOnline, addCommentOnline, getStages } from './cards.js';
import { listarTarefas, criarTarefa, editarTarefa } from './tarefas.js';
import { listarDocs, criarDoc } from './documentos.js';
import { agora, iso, sha256, b64u, aleatorio } from './util.js';

var KF = globalThis.KanzoFields;
export var AUTOR_AGENTE = 'via OpenCode';
var RE_CHAVE = /^kzo_[A-Za-z0-9_-]{43}$/;
var JANELA_RATE_S = 60, RATE_PADRAO = 120;
var STATUS_OK = { todo: 1, doing: 1, done: 1, review: 1, backlog: 1 };
var FECHAMENTO = { 'ganho-handoff': 1, 'old-falhou': 1 };
var SAUDE_OK = KF.FIELDS.saude.options; // ["No prazo","Atenção","Em risco","Bloqueado"]
/* corpo do PATCH/POST → campo da descrição (fields.js). Aceita nome PT e EN. */
var CAMPOS = { saude: 'saude', health: 'saude', prazo: 'prazo', deadline: 'prazo', situacao: 'situacao', situacao_atual: 'situacao', current_situation: 'situacao',
  proxima: 'proxima', proxima_acao: 'proxima', next_action: 'proxima', responsaveis: 'responsaveis', owners: 'responsaveis', solucao: 'solucao', solution: 'solucao' };
var DIRETOS = { stage: 'stage', etapa: 'stage', status: 'status', confirmar: 'confirmar' };
var PROIBIDOS_VALOR = /^(tcv|mrc|otc|values?|valores?|custo|custos|cost|costs|margem|margin|pricing|preco|price|net|gross|gm)$/i;

export function temBearer(req) { return /^Bearer\s+/i.test(req.headers.get('Authorization') || ''); }
export function gerarChave() { return 'kzo_' + b64u(aleatorio(32)); }

function negado(msg, code, status) { return json({ erro: msg, error: code || 'forbidden' }, status || 403); }

/* Texto com custo/margem/pricing interno (mesmas regras do corte do perfil leitura) não entra pela chave. */
export function temCustoMargem(v) {
  if (v == null) return false;
  var t = Array.isArray(v) ? v.join(', ') : String(v);
  return K.trechoLeitura(t) !== t || K.descricaoLeitura(t) !== t;
}

async function chaveIpBloqueada(req, env) {
  var ip = req.headers.get('CF-Connecting-IP') || 'x', k = (await sha256('ip|' + ip + '|apikey')).slice(0, 24), t = agora();
  var r = await dataDB(env).prepare('SELECT n, ini FROM presales_tentativas WHERE chave = ?').bind(k).first();
  return { k: k, t: t, r: r, bloqueado: !!(r && t - r.ini <= JANELA_S && r.n >= MAX_IP) };
}
async function contarFalhaIp(env, st) {
  if (!st.r || st.t - st.r.ini > JANELA_S) await dataDB(env).prepare('INSERT OR REPLACE INTO presales_tentativas (chave, n, ini) VALUES (?,1,?)').bind(st.k, st.t).run();
  else await dataDB(env).prepare('UPDATE presales_tentativas SET n = n + 1 WHERE chave = ?').bind(st.k).run();
}

/* Devolve { s } (sessão de máquina) ou { resp } (erro 401/429). */
export async function autenticarChave(req, env) {
  var ip = await chaveIpBloqueada(req, env);
  if (ip.bloqueado) return { resp: json({ erro: 'Muitas tentativas com chave inválida. Aguarde 15 minutos.', error: 'rate_limit' }, 429, { 'Retry-After': String(JANELA_S) }) };
  var tk = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  var row = RE_CHAVE.test(tk) ? await dataDB(env).prepare('SELECT * FROM api_keys WHERE hash = ?').bind(await sha256(tk)).first() : null;
  if (!row || row.revogada_em) {
    await contarFalhaIp(env, ip);
    return { resp: json({ erro: row ? 'Chave revogada.' : 'Chave inválida.', error: row ? 'revoked' : 'invalid_key' }, 401, { 'WWW-Authenticate': 'Bearer' }) };
  }
  var t = agora(), max = parseInt(env.API_RATE_MAX || '', 10) || RATE_PADRAO, db = dataDB(env);
  var rl = await db.prepare('SELECT ini, n FROM api_key_rate WHERE key_id = ?').bind(row.id).first();
  if (!rl || t - rl.ini >= JANELA_RATE_S) await db.prepare('INSERT OR REPLACE INTO api_key_rate (key_id, ini, n) VALUES (?,?,1)').bind(row.id, t).run();
  else {
    if (rl.n >= max) return { resp: json({ erro: 'Limite de ' + max + ' pedidos por minuto. Aguarde.', error: 'rate_limit' }, 429, { 'Retry-After': String(JANELA_RATE_S - (t - rl.ini)) }) };
    await db.prepare('UPDATE api_key_rate SET n = n + 1 WHERE key_id = ?').bind(row.id).run();
  }
  if (!row.ultimo_uso_em || Date.now() - Date.parse(row.ultimo_uso_em) > 60000) await db.prepare('UPDATE api_keys SET ultimo_uso_em = ? WHERE id = ?').bind(iso(), row.id).run();
  return { s: { id: null, nome: AUTOR_AGENTE, email: AUTOR_AGENTE, papel: 'agente', agente: true, key_id: row.id, key_nome: row.nome, hash: null }, max: max };
}

/* Card como o agente vê: perfil leitura (sem custo/margem) + campos estruturados prontos. */
async function cardAgente(env, id) {
  var c = await getCard(env, id, true); if (!c) return null;
  var campos = {}; ['solucao', 'responsaveis', 'prazo', 'saude', 'situacao', 'proxima'].forEach(function (k) { campos[k] = KF.ler(c, k); });
  campos.prazo_fonte = KF.prazo(c.description).fonte;
  c.campos = campos;
  return c;
}
async function corpoDe(resp) { try { return await resp.clone().json(); } catch (e) { return null; } }
/* Repassa erro de um handler sem vazar a descrição completa (ex.: 409 devolve "current" do perfil admin). */
async function erroLimpo(resp) { var b = await corpoDe(resp) || {}; delete b.current; return json(b, resp.status); }

function lerCorpoAgente(b, criar) {
  var campos = {}, diretos = {}, ruins = [], proibidos = [];
  Object.keys(b).forEach(function (k) {
    if (CAMPOS[k]) campos[CAMPOS[k]] = b[k];
    else if (DIRETOS[k]) diretos[DIRETOS[k]] = b[k];
    else if (criar && (k === 'title' || k === 'titulo')) diretos.title = b[k];
    else if (criar && (k === 'description' || k === 'descricao')) diretos.description = b[k];
    else if (PROIBIDOS_VALOR.test(k)) proibidos.push(k);
    else ruins.push(k);
  });
  return { campos: campos, diretos: diretos, ruins: ruins, proibidos: proibidos };
}
function validarCampos(campos) {
  for (var k in campos) {
    var v = campos[k];
    if (v != null && typeof v !== 'string' && !(k === 'responsaveis' && Array.isArray(v))) return 'Campo ' + k + ' precisa ser texto.';
    if (temCustoMargem(v)) return 'custo';
    if (k === 'saude' && v && SAUDE_OK.indexOf(String(v).trim()) < 0) return 'Saúde precisa ser uma de: ' + SAUDE_OK.join(', ') + '.';
    if (k === 'prazo' && v) { var n = KF.normaliza('prazo', v); var dt = new Date(n + 'T12:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(n) || isNaN(dt) || dt.toISOString().slice(0, 10) !== n) return 'Prazo inválido (use AAAA-MM-DD ou dd/mm/aaaa).'; }
    if (typeof v === 'string' && v.length > 2000) return 'Campo ' + k + ' longo demais (máx. 2.000).';
  }
  return null;
}
function aplicarCampos(desc, campos) { var d = desc || ''; Object.keys(campos).forEach(function (k) { d = KF.set(d, k, campos[k] == null ? '' : campos[k]); }); return d; }
function precisaConfirmar(antes, stage, status) {
  if (stage && stage !== antes.stage && (FECHAMENTO[stage] || FECHAMENTO[antes.stage])) return true;
  if (status && status !== antes.status && (status === 'done' || antes.status === 'done')) return true;
  return false;
}
function validarDiretos(d) {
  if (d.stage != null && d.stage !== '' && STAGE_ORDER.indexOf(String(d.stage)) < 0) return 'Etapa desconhecida. Use uma de: ' + STAGE_ORDER.join(', ') + '.';
  if (d.status != null && !STATUS_OK[String(d.status)]) return 'Status desconhecido. Use: todo, doing, review, backlog, done.';
  return null;
}
function msgCampos(l) {
  if (l.proibidos.length) return negado('A chave do OpenCode não lê nem grava custo, margem ou valores (' + l.proibidos.join(', ') + '). Valores só pelo Guilherme no app.', 'custo_margem');
  if (l.ruins.length) return negado('Campo não permitido para o OpenCode: ' + l.ruins.join(', ') + '. Permitidos: etapa, status, saude, prazo, situacao, proxima, responsaveis, solucao' + '.', 'campo_nao_permitido');
  return null;
}
async function historicoCard(env, s, cardId, acao, depois, req) { await audit(env, s, acao.slice(0, 160), 'card', cardId, null, depois || null, req); }

async function criarCardAgente(env, s, b, req) {
  var l = lerCorpoAgente(b, true), m = msgCampos(l); if (m) return m;
  var title = String(l.diretos.title || '').trim(); if (!title) return json({ erro: 'title obrigatório', error: 'title' }, 400);
  if (temCustoMargem(title) || temCustoMargem(l.diretos.description)) return negado('Texto com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
  var ev = validarCampos(l.campos) || validarDiretos(l.diretos);
  if (ev === 'custo') return negado('Texto com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
  if (ev) return json({ erro: ev, error: 'validacao' }, 400);
  if (FECHAMENTO[l.diretos.stage] || l.diretos.status === 'done') { if (l.diretos.confirmar !== true) return json({ erro: 'Criar já como ganho/perdido/concluído precisa de "confirmar": true (confirme com o Guilherme).', error: 'confirmar' }, 409); }
  var desc = aplicarCampos(String(l.diretos.description || ''), l.campos);
  var r = await createCardOnline(env, s, { title: title.slice(0, 300), stage: l.diretos.stage || undefined, status: l.diretos.status || 'todo', solution: l.campos.solucao || undefined, description: desc }, req);
  if (r.status !== 200) return erroLimpo(r);
  var j = await corpoDe(r);
  return json({ ok: true, card: await cardAgente(env, j.id) });
}

async function editarCardAgente(env, s, id, b, req) {
  var l = lerCorpoAgente(b, false), m = msgCampos(l); if (m) return m;
  if (!Object.keys(l.campos).length && l.diretos.stage == null && l.diretos.status == null) return json({ erro: 'Nada para alterar.', error: 'vazio' }, 400);
  var ev = validarCampos(l.campos) || validarDiretos(l.diretos);
  if (ev === 'custo') return negado('Texto com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
  if (ev) return json({ erro: ev, error: 'validacao' }, 400);
  var antes = await getCard(env, id); // completo (servidor), nunca sai para o agente
  if (!antes || antes.deleted_at) return json({ erro: 'Não encontrado', error: 'not_found' }, 404);
  if (precisaConfirmar(antes, l.diretos.stage, l.diretos.status) && l.diretos.confirmar !== true)
    return json({ erro: 'Ganho, perda, conclusão ou reabertura precisam de "confirmar": true (confirme com o Guilherme antes).', error: 'confirmar' }, 409);
  var patch = {};
  if (l.diretos.stage != null) patch.stage = String(l.diretos.stage);
  if (l.diretos.status != null) patch.status = String(l.diretos.status);
  if (l.campos.solucao !== undefined) patch.solution = l.campos.solucao || '';
  if (Object.keys(l.campos).length) {
    var nova = aplicarCampos(antes.description, l.campos);
    if (nova !== (antes.description || '')) { patch.description = nova; patch.expect_description_sha256 = await sha256(antes.description || ''); }
  }
  var r = await patchCardOnline(env, s, id, patch, req);
  if (r.status !== 200) return erroLimpo(r);
  return json({ ok: true, card: await cardAgente(env, id) });
}

async function tarefaLimpa(resp) { var j = await corpoDe(resp) || {}; if (j.title) j.title = K.trechoLeitura(j.title); return j; }

async function rotasAgente(req, env, url, s) {
  var p = url.pathname, method = req.method, m, b;
  if (method === 'DELETE') return negado('A chave do OpenCode não exclui nada. Exclusão só pelo Guilherme no app.', 'delete_nao_permitido');
  if (p === '/api/agent/whoami' && method === 'GET') return json({ ok: true, autor: AUTOR_AGENTE, chave: s.key_nome, perfil: 'leitura (sem custo/margem) + escrita limitada',
    pode: ['listar/ler cards e tarefas', 'listar e criar documentos (links) do card', 'criar card', 'editar etapa/status/saude/prazo/situacao/proxima/responsaveis/solucao', 'criar/editar/concluir tarefa', 'comentar'],
    nao_pode: ['excluir', 'custo/margem/pricing interno', 'TCV/MRC/OTC', 'descrição livre', 'admin'], etapas: STAGE_ORDER.map(function (k) { return { key: k, label: STAGE_LABEL[k] }; }), saude: SAUDE_OK });
  if (p === '/api/stages' && method === 'GET') return json(await getStages(env));
  if (p === '/api/cards' && method === 'GET') return json(await listCards(env, url, true));
  if (p === '/api/cards' && method === 'POST') { b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400); return await criarCardAgente(env, s, b, req); }
  if ((m = p.match(/^\/api\/cards\/(\d+)$/))) {
    var id = parseInt(m[1], 10);
    if (method === 'GET') { var c = await cardAgente(env, id); return c && !c.deleted_at ? json(c) : json({ erro: 'Não encontrado', error: 'not_found' }, 404); }
    if (method === 'PATCH') { b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400); return await editarCardAgente(env, s, id, b, req); }
  }
  if ((m = p.match(/^\/api\/cards\/(\d+)\/audit$/)) && method === 'GET') return json(await auditCard(env, parseInt(m[1], 10), true));
  if ((m = p.match(/^\/api\/cards\/(\d+)\/comments$/)) && method === 'POST') {
    b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400);
    if (temCustoMargem(b.body)) return negado('Comentário com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
    var cid = parseInt(m[1], 10), body = String(b.body || '').trim().slice(0, 4000);
    var rc = await addCommentOnline(env, s, cid, { body: body }, req); // autor = "via OpenCode" (s.nome); b.author é ignorado
    if (rc.status !== 200) return erroLimpo(rc);
    var jc = await corpoDe(rc);
    await historicoCard(env, s, cid, 'Comentário: ' + body.slice(0, 120), { comment_id: jc.id }, req);
    return json({ ok: true, id: jc.id, card_id: cid, author: jc.author, body: jc.body, created_at: jc.created_at });
  }
  if (p === '/api/tasks' && method === 'GET') return json(await listarTarefas(env, url, true));
  if ((m = p.match(/^\/api\/cards\/(\d+)\/tasks$/))) {
    if (method === 'GET') { url.searchParams.set('card_id', m[1]); return json(await listarTarefas(env, url, true)); }
    if (method === 'POST') {
      b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400);
      var extra = Object.keys(b).filter(function (k) { return k !== 'title' && k !== 'due_date'; });
      if (extra.length) return negado('Para tarefa o OpenCode só manda title e due_date.', 'campo_nao_permitido');
      if (temCustoMargem(b.title)) return negado('Tarefa com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
      var cardT = parseInt(m[1], 10), rt = await criarTarefa(env, s, cardT, { title: b.title, due_date: b.due_date }, req);
      if (rt.status !== 200) return erroLimpo(rt);
      var jt = await tarefaLimpa(rt);
      await historicoCard(env, s, cardT, 'Tarefa criada: ' + jt.title + (jt.due_date ? ' (prazo ' + jt.due_date + ')' : ''), { task_id: jt.id }, req);
      return json(jt);
    }
  }
  /* 18/11: documentos e links do card. A chave lista e cria (mesmas regras de validação, duplicata e versão); NÃO edita, remove nem vê histórico/removidos. */
  if ((m = p.match(/^\/api\/cards\/(\d+)\/docs$/))) {
    if (method === 'GET') return await listarDocs(env, parseInt(m[1], 10), { leitura: true, admin: false });
    if (method === 'POST') {
      b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400);
      var okD = ['title', 'doc_type', 'url', 'version', 'note', 'parent_id'], extraD = Object.keys(b).filter(function (k) { return okD.indexOf(k) < 0; });
      if (extraD.length) return negado('Para documento o OpenCode só manda title, doc_type, url, version, note e parent_id.', 'campo_nao_permitido');
      if (temCustoMargem(b.title) || temCustoMargem(b.note)) return negado('Documento com custo/margem/pricing interno no título ou na observação não entra pelo OpenCode.', 'custo_margem');
      var cardD = parseInt(m[1], 10), rd = await criarDoc(env, s, cardD, b, req, { responsavel: AUTOR_AGENTE, leitura: true });
      if (rd.status === 200) { var jd = await corpoDe(rd); await historicoCard(env, s, cardD, 'Documento adicionado: ' + String(jd.title || '').slice(0, 100) + ' (' + jd.doc_type + (jd.version ? ' ' + jd.version : '') + ')', { doc_id: jd.id }, req); }
      return rd;
    }
  }
  if ((m = p.match(/^\/api\/tasks\/(\d+)$/)) && method === 'PATCH') {
    b = await corpoJson(req); if (!b) return json({ erro: 'JSON inválido' }, 400);
    var extra2 = Object.keys(b).filter(function (k) { return k !== 'title' && k !== 'due_date' && k !== 'done'; });
    if (extra2.length) return negado('Para tarefa o OpenCode só manda title, due_date e done.', 'campo_nao_permitido');
    if (b.title !== undefined && temCustoMargem(b.title)) return negado('Tarefa com custo/margem/pricing interno não entra pelo OpenCode.', 'custo_margem');
    if (b.done !== undefined && typeof b.done !== 'boolean') return json({ erro: 'done precisa ser true/false.', error: 'done' }, 400);
    var tid = parseInt(m[1], 10), re = await editarTarefa(env, s, tid, { title: b.title, due_date: b.due_date, done: b.done }, req);
    if (re.status !== 200) return erroLimpo(re);
    var je = await tarefaLimpa(re);
    var acao = b.done === true && b.title === undefined && b.due_date === undefined ? 'Tarefa concluída: ' : b.done === false ? 'Tarefa reaberta: ' : 'Tarefa editada: ';
    await historicoCard(env, s, je.card_id, acao + je.title + (je.due_date ? ' (prazo ' + je.due_date + ')' : ''), { task_id: tid }, req);
    return json(je);
  }
  return negado('Fora do escopo da chave do OpenCode.', 'fora_do_escopo');
}

export async function rotaAgente(req, env, url) {
  var a = await autenticarChave(req, env); if (a.resp) return a.resp;
  if (url.pathname.indexOf('/api/') !== 0) return negado('A chave do OpenCode só acessa a API.', 'fora_do_escopo');
  var r = await rotasAgente(req, env, url, a.s);
  r.headers.set('X-RateLimit-Limit', String(a.max));
  return r;
}

/* ---- gestão das chaves (sessão admin do Guilherme; rotas em routes.js) ---- */
export async function adminChaves(env, s, req, method, id, acao, b) {
  var db = dataDB(env);
  if (method === 'GET' && !id) {
    var r = await db.prepare('SELECT id, nome, prefixo, criada_em, criada_por, revogada_em, ultimo_uso_em FROM api_keys ORDER BY id DESC').all();
    return json({ keys: r.results || [] });
  }
  if (method === 'POST' && !id) {
    var nome = String((b && b.nome) || 'OpenCode').trim().slice(0, 60) || 'OpenCode', chave = gerarChave(), t = iso();
    var ins = await db.prepare('INSERT INTO api_keys (nome, prefixo, hash, criada_em, criada_por) VALUES (?,?,?,?,?)').bind(nome, chave.slice(0, 12), await sha256(chave), t, s.email).run();
    await audit(env, s, 'create', 'api_key', ins.meta.last_row_id, null, { nome: nome, prefixo: chave.slice(0, 12) }, req);
    return json({ ok: true, id: ins.meta.last_row_id, nome: nome, prefixo: chave.slice(0, 12), chave: chave, aviso: 'Copie agora: a chave não aparece de novo.' });
  }
  if (method === 'POST' && id && acao === 'revoke') {
    var k = await db.prepare('SELECT id, revogada_em FROM api_keys WHERE id = ?').bind(id).first();
    if (!k) return json({ erro: 'Chave não encontrada.', error: 'not_found' }, 404);
    if (!k.revogada_em) await db.prepare('UPDATE api_keys SET revogada_em = ? WHERE id = ?').bind(iso(), id).run();
    await audit(env, s, 'revoke', 'api_key', id, null, null, req);
    return json({ ok: true, id: id, revogada: true });
  }
  return json({ erro: 'Método não permitido' }, 405);
}
