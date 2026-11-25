/* presales-kanzo · src/documentos.js — "Documentos e links" dentro do card (18/11/2026, migração 10: card_documents + card_document_history).
   SÓ LINKS (sem upload de arquivo). O servidor NUNCA busca a URL: ela é só texto guardado e mostrado (sem risco de SSRF).
   Mesmo assim a URL passa por validação rígida: só http/https, sem usuário/senha, sem localhost, rede privada, link-local ou outros esquemas.
   Regras: duplicata por URL normalizada no mesmo card (entre os não removidos); versionamento por "nova versão de" (mesmo card e mesmo tipo);
   o mais novo de cada tipo é o "Atual"; remoção é SEMPRE lógica (motivo obrigatório); toda criação, edição e remoção entra em
   card_document_history (só inclui, nunca altera nem apaga: triggers no banco). Escrita só admin (rotas) + chave do OpenCode (listar e criar). */
'use strict';
import { dataDB, audit } from './db.js';
import { K } from './format.js';
import { json } from './http.js';
import { iso } from './util.js';

export var TIPOS_DOC = ['Apresentação final', 'Proposta técnica', 'Proposta comercial', 'Cotação', 'Pricing', 'Contrato', 'Ata', 'Outro'];
export var LIM = { tituloMin: 3, tituloMax: 120, versao: 20, nota: 300, motivo: 200, url: 2000, porCard: 200 };

/* ---------- texto ---------- */
/* Remove controles, zero-width e marcas bidi (anti spoofing); colapsa espaços. A tela sempre escapa HTML (esc) e nunca usa innerHTML cru. */
var INVISIVEL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
export function limpaTexto(v) { return String(v == null ? '' : v).replace(INVISIVEL, ' ').replace(/\s+/g, ' ').trim(); }

/* ---------- URL ---------- */
function ipv4(h) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if (!m) return null;
  var p = m.slice(1).map(Number); return p.some(function (x) { return x > 255; }) ? null : p;
}
function ipv4Bloqueado(p) {
  var a = p[0], b = p[1];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && p[2] === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
/* hostname do WHATWG URL já vem normalizado: IPv6 entre [ ] em hex comprimido, minúsculo. Expande para 8 grupos. */
function ipv6Grupos(h) {
  var s = h.replace(/^\[|\]$/g, ''), i = s.indexOf('::'), cab, cau;
  if (/%/.test(s)) return null;
  var ult = s.split(':').pop(); if (ult.indexOf('.') >= 0) { var q = ipv4(ult); if (!q) return null; s = s.slice(0, s.length - ult.length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16); i = s.indexOf('::'); }
  if (i >= 0) { cab = s.slice(0, i) ? s.slice(0, i).split(':') : []; cau = s.slice(i + 2) ? s.slice(i + 2).split(':') : []; var f = 8 - cab.length - cau.length; if (f < 1) return null; cab = cab.concat(new Array(f).fill('0'), cau); }
  else cab = s.split(':');
  if (cab.length !== 8) return null;
  var g = cab.map(function (x) { return /^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN; });
  return g.some(isNaN) ? null : g;
}
function ipv6Bloqueado(g) {
  var tudoZero = function (a, n) { for (var k = 0; k < n; k++) if (a[k] !== 0) return false; return true; };
  if (tudoZero(g, 7) && (g[7] === 0 || g[7] === 1)) return true;              // :: e ::1
  if (tudoZero(g, 5) && g[5] === 0xffff) return true;                         // ::ffff:a.b.c.d (IPv4 mapeado)
  if (tudoZero(g, 6)) return true;                                            // ::a.b.c.d (IPv4 compatível, legado)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                          // 64:ff9b::/96 (NAT64)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                // fc00::/7 (ULA)
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                // fe80::/10 (link-local)
  if ((g[0] & 0xff00) === 0xff00) return true;                                // ff00::/8 (multicast)
  if (g[0] === 0x2002) return true;                                           // 6to4 (embute IPv4)
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;         // Teredo e documentação
  return (g[0] & 0xe000) !== 0x2000;                                          // só unicast global (2000::/3) passa
}
export function hostBloqueado(host) {
  var h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return 'host';
  if (h.charAt(0) === '[') { var g = ipv6Grupos(h); return !g || ipv6Bloqueado(g) ? 'ip_privado' : null; }
  if (/^[0-9.]+$/.test(h)) { var p = ipv4(h); return !p || ipv4Bloqueado(p) ? 'ip_privado' : null; }
  if (h === 'localhost' || /\.(localhost|local|localdomain|internal|intranet|lan|home|corp|private)$/.test(h)) return 'localhost';
  if (h.indexOf('.') < 0) return 'host_interno'; // nome sem ponto = rede interna
  if (h.length > 253 || !/^[a-z0-9._-]+$/.test(h)) return 'host';
  return null;
}
var MSG_URL = {
  vazia: 'Informe o link.', longa: 'Link longo demais (máx. ' + LIM.url + ').', formato: 'Link inválido. Use um endereço completo, por exemplo https://…',
  esquema: 'Só links http:// ou https:// são aceitos.', credenciais: 'O link não pode ter usuário e senha dentro.', localhost: 'Links locais (localhost) não são aceitos.',
  host_interno: 'Links de rede interna não são aceitos.', ip_privado: 'Endereços IP privados, locais ou reservados não são aceitos.', host: 'Endereço do link inválido.'
};
/* { ok, url (limpa), norm } ou { ok:false, motivo, msg } */
export function validarUrl(v) {
  var bruto = String(v == null ? '' : v).trim();
  if (!bruto) return { ok: false, motivo: 'vazia', msg: MSG_URL.vazia };
  if (bruto.length > LIM.url) return { ok: false, motivo: 'longa', msg: MSG_URL.longa };
  if (/[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/.test(bruto)) return { ok: false, motivo: 'formato', msg: MSG_URL.formato };
  var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(bruto);
  if (!m) return { ok: false, motivo: 'formato', msg: MSG_URL.formato };
  var esq = m[1].toLowerCase();
  if (esq !== 'http' && esq !== 'https') return { ok: false, motivo: 'esquema', msg: MSG_URL.esquema };
  if (!/^https?:\/\//i.test(bruto)) return { ok: false, motivo: 'formato', msg: MSG_URL.formato };
  var u; try { u = new URL(bruto); } catch (e) { return { ok: false, motivo: 'formato', msg: MSG_URL.formato }; }
  if (u.username || u.password) return { ok: false, motivo: 'credenciais', msg: MSG_URL.credenciais };
  var b = hostBloqueado(u.hostname); if (b) return { ok: false, motivo: b, msg: MSG_URL[b] };
  return { ok: true, url: u.href, norm: normalizarUrl(u) };
}
/* Chave de duplicidade: esquema+host minúsculos, sem porta padrão, sem #âncora, sem "/" final, sem utm_*, parâmetros em ordem. */
export function normalizarUrl(u) {
  if (typeof u === 'string') u = new URL(u);
  var host = u.hostname.toLowerCase().replace(/\.$/, ''), port = u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) ? ':' + u.port : '';
  var path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
  var ps = []; u.searchParams.forEach(function (v, k) { if (!/^utm_/i.test(k)) ps.push([k, v]); });
  ps.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
  var q = ps.length ? '?' + ps.map(function (x) { return encodeURIComponent(x[0]) + '=' + encodeURIComponent(x[1]); }).join('&') : '';
  return u.protocol + '//' + host + port + path + q;
}

/* ---------- campos ---------- */
/* Devolve { campos } (já limpos) ou { erro: { campo, msg, motivo } }. completo = criação (título, tipo e link obrigatórios). */
export function validarCampos(b, completo) {
  var out = {}, e = function (campo, motivo, msg) { return { erro: { campo: campo, motivo: motivo, msg: msg } }; };
  if (completo || b.title !== undefined) {
    var t = limpaTexto(b.title);
    if (t.length < LIM.tituloMin) return e('title', 'titulo_curto', 'Título obrigatório (mínimo ' + LIM.tituloMin + ' caracteres).');
    if (t.length > LIM.tituloMax) return e('title', 'titulo_longo', 'Título longo demais (máx. ' + LIM.tituloMax + ').');
    out.title = t;
  }
  if (completo || b.doc_type !== undefined) {
    var tp = String(b.doc_type == null ? '' : b.doc_type).trim();
    if (TIPOS_DOC.indexOf(tp) < 0) return e('doc_type', 'tipo', 'Escolha um tipo da lista: ' + TIPOS_DOC.join(', ') + '.');
    out.doc_type = tp;
  }
  if (completo || b.url !== undefined) {
    var u = validarUrl(b.url); if (!u.ok) return e('url', u.motivo, u.msg);
    out.url = u.url; out.url_norm = u.norm;
  }
  if (b.version !== undefined) {
    var v = limpaTexto(b.version);
    if (v.length > LIM.versao) return e('version', 'versao_longa', 'Versão longa demais (máx. ' + LIM.versao + ').');
    if (v && !/^[A-Za-z0-9._ -]+$/.test(v)) return e('version', 'versao_formato', 'Versão: use letras, números, ponto, hífen ou espaço (ex.: v1, v11, zip10).');
    out.version = v || null;
  }
  if (b.note !== undefined) {
    var n = limpaTexto(b.note);
    if (n.length > LIM.nota) return e('note', 'nota_longa', 'Observação longa demais (máx. ' + LIM.nota + ').');
    out.note = n || null;
  }
  return { campos: out };
}
function logValidacao(env, s, cardId, erro, extra) {
  /* Log estruturado (Workers Logs). Nunca grava o link inteiro: só o motivo e o campo. */
  try { console.warn(JSON.stringify({ evento: 'docs_validacao', campo: erro.campo, motivo: erro.motivo, card_id: cardId || null, quem: (s && (s.email || s.nome)) || null, em: iso(), extra: extra || undefined })); } catch (_) {}
}
function recusa(env, s, cardId, erro, status, extra) {
  logValidacao(env, s, cardId, erro, extra);
  return json({ erro: erro.msg, error: erro.motivo, campo: erro.campo }, status || 400);
}

/* ---------- leitura ---------- */
function nomeDe(s) { return String((s && (s.nome || s.email)) || 'web').slice(0, 80); }
export function docDTO(r, o) {
  o = o || {}; var leitura = !!o.leitura;
  var d = {
    id: r.id, card_id: r.card_id, title: leitura ? K.trechoLeitura(r.title) : r.title, doc_type: r.doc_type, url: r.url, version: r.version || null,
    note: r.note ? (leitura ? K.trechoLeitura(r.note) : r.note) : null, parent_id: r.parent_id || null, responsible: r.responsible,
    created_at: r.created_at, updated_at: r.updated_at || null, updated_by: leitura ? null : (r.updated_by || null), atual: !!o.atual
  };
  if (r.removed_at) { d.removed_at = r.removed_at; d.removed_by = r.removed_by; d.removal_reason = r.removal_reason; }
  return d;
}
/* "Atual" = o mais novo (created_at, depois id) de cada tipo entre os não removidos. */
export function marcarAtuais(linhas) {
  var melhor = {};
  linhas.forEach(function (r) {
    if (r.removed_at) return;
    var m = melhor[r.doc_type];
    if (!m || r.created_at > m.created_at || (r.created_at === m.created_at && r.id > m.id)) melhor[r.doc_type] = r;
  });
  return melhor;
}
async function cardAtivo(env, id) { return await dataDB(env).prepare('SELECT id, title, stage FROM cards WHERE id = ? AND deleted_at IS NULL').bind(id).first(); }
async function lerDoc(env, id) { return await dataDB(env).prepare('SELECT * FROM card_documents WHERE id = ?').bind(id).first(); }

/* GET /api/cards/:id/docs — { docs (não removidos, mais novos primeiro), removidos (só admin), tipos } */
export async function listarDocs(env, cardId, opts) {
  opts = opts || {};
  var card = await cardAtivo(env, cardId); if (!card) return json({ erro: 'Card não encontrado.', error: 'not_found' }, 404);
  var r = await dataDB(env).prepare('SELECT * FROM card_documents WHERE card_id = ? ORDER BY created_at DESC, id DESC').bind(cardId).all();
  var linhas = r.results || [], melhor = marcarAtuais(linhas), leitura = !!opts.leitura;
  var docs = linhas.filter(function (x) { return !x.removed_at; }).map(function (x) { return docDTO(x, { leitura: leitura, atual: melhor[x.doc_type] && melhor[x.doc_type].id === x.id }); });
  var out = { card_id: cardId, tipos: TIPOS_DOC, docs: docs };
  if (opts.admin) out.removidos = linhas.filter(function (x) { return x.removed_at; }).sort(function (a, b) { return a.removed_at < b.removed_at ? 1 : -1; }).map(function (x) { return docDTO(x, { leitura: false, atual: false }); });
  return json(out);
}
/* GET /api/docs/counts — { counts: { card_id: n } } só não removidos de cards ativos (ícone no funil/quadro). */
export async function contarDocs(env) {
  var r = await dataDB(env).prepare('SELECT d.card_id AS card_id, COUNT(*) AS n FROM card_documents d JOIN cards c ON c.id = d.card_id AND c.deleted_at IS NULL WHERE d.removed_at IS NULL GROUP BY d.card_id').all();
  var m = {}; (r.results || []).forEach(function (x) { m[x.card_id] = x.n; });
  return json({ counts: m });
}
/* Documentos "Atuais" de um card (relatório/exportação do card). */
export async function docsAtuais(env, cardId) {
  var r = await dataDB(env).prepare('SELECT * FROM card_documents WHERE card_id = ? AND removed_at IS NULL ORDER BY created_at DESC, id DESC').bind(cardId).all();
  var linhas = r.results || [], melhor = marcarAtuais(linhas);
  return TIPOS_DOC.filter(function (t) { return melhor[t]; }).map(function (t) { return melhor[t]; });
}

/* ---------- histórico (append-only) ---------- */
var CAMPOS = ['title', 'doc_type', 'url', 'version', 'note'];
function foto(r) { var o = {}; CAMPOS.forEach(function (k) { o[k] = r[k] == null ? null : r[k]; }); o.parent_id = r.parent_id || null; return o; }
async function registrar(env, s, doc, acao, antes, depois, motivo) {
  var mud = {};
  if (antes && depois) CAMPOS.forEach(function (k) { if ((antes[k] || null) !== (depois[k] || null)) mud[k] = { de: antes[k] == null ? null : antes[k], para: depois[k] == null ? null : depois[k] }; });
  await dataDB(env).prepare('INSERT INTO card_document_history (doc_id, card_id, action, at, by_user, before_json, after_json, changes_json, reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(doc.id, doc.card_id, acao, iso(), nomeDe(s), antes ? JSON.stringify(foto(antes)) : null, depois ? JSON.stringify(foto(depois)) : null, Object.keys(mud).length ? JSON.stringify(mud) : null, motivo || null).run();
}
/* GET /api/docs/:id/history — só admin: todas as ações do item + a cadeia de versões. */
export async function historicoDoc(env, id) {
  var d = await lerDoc(env, id); if (!d) return json({ erro: 'Documento não encontrado.', error: 'not_found' }, 404);
  var h = await dataDB(env).prepare('SELECT * FROM card_document_history WHERE doc_id = ? ORDER BY id DESC').bind(id).all();
  var historico = (h.results || []).map(function (x) {
    return { id: x.id, action: x.action, at: x.at, by: x.by_user, reason: x.reason || null, changes: x.changes_json ? JSON.parse(x.changes_json) : null, before: x.before_json ? JSON.parse(x.before_json) : null, after: x.after_json ? JSON.parse(x.after_json) : null };
  });
  var todos = await dataDB(env).prepare('SELECT * FROM card_documents WHERE card_id = ? AND doc_type = ? ORDER BY created_at, id').bind(d.card_id, d.doc_type).all();
  return json({ doc_id: id, card_id: d.card_id, historico: historico, versoes: cadeia(todos.results || [], id).map(function (x) { return docDTO(x, {}); }) });
}
/* Cadeia de versões de um item (ancestrais + descendentes), mais antigo primeiro. Passa por itens removidos para não quebrar a cadeia. */
export function cadeia(linhas, id) {
  var por = {}; linhas.forEach(function (x) { por[x.id] = x; });
  var raiz = por[id]; if (!raiz) return [];
  var guarda = 0; while (raiz.parent_id && por[raiz.parent_id] && guarda++ < 500) raiz = por[raiz.parent_id];
  var out = [], vistos = {};
  (function descer(n) { if (!n || vistos[n.id]) return; vistos[n.id] = 1; out.push(n); linhas.filter(function (x) { return x.parent_id === n.id; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.id - b.id; }).forEach(descer); })(raiz);
  return out;
}

/* ---------- escrita ---------- */
async function acharDuplicata(env, cardId, norm, ignoraId) {
  var sql = 'SELECT id, title, version FROM card_documents WHERE card_id = ? AND url_norm = ? AND removed_at IS NULL' + (ignoraId ? ' AND id <> ?' : '') + ' LIMIT 1';
  var st = dataDB(env).prepare(sql);
  return await (ignoraId ? st.bind(cardId, norm, ignoraId) : st.bind(cardId, norm)).first();
}
function msgDup(x) { return 'Este link já está neste card: “' + x.title + '”' + (x.version ? ' (' + x.version + ')' : '') + '. Para um arquivo novo, use “Nova versão”.'; }

/* POST /api/cards/:id/docs  { title, doc_type, url, version?, note?, parent_id? } */
export async function criarDoc(env, s, cardId, b, req, opts) {
  opts = opts || {};
  var card = await cardAtivo(env, cardId); if (!card) return json({ erro: 'Card não encontrado.', error: 'not_found' }, 404);
  var v = validarCampos(b, true); if (v.erro) return recusa(env, s, cardId, v.erro, 400);
  var c = v.campos, db = dataDB(env);
  var n = await db.prepare('SELECT COUNT(*) AS n FROM card_documents WHERE card_id = ? AND removed_at IS NULL').bind(cardId).first();
  if (n && n.n >= LIM.porCard) return recusa(env, s, cardId, { campo: 'card', motivo: 'limite', msg: 'Limite de ' + LIM.porCard + ' documentos neste card.' }, 400);
  var pai = null;
  if (b.parent_id != null && b.parent_id !== '') {
    var pid = parseInt(b.parent_id, 10);
    pai = pid > 0 ? await lerDoc(env, pid) : null;
    if (!pai || pai.removed_at || pai.card_id !== cardId) return recusa(env, s, cardId, { campo: 'parent_id', motivo: 'pai_invalido', msg: 'A versão anterior precisa ser um documento ativo deste card.' }, 400);
    if (pai.doc_type !== c.doc_type) return recusa(env, s, cardId, { campo: 'parent_id', motivo: 'pai_tipo', msg: 'A nova versão precisa ser do mesmo tipo da versão anterior (' + pai.doc_type + ').' }, 400);
  }
  var dup = await acharDuplicata(env, cardId, c.url_norm);
  if (dup) return recusa(env, s, cardId, { campo: 'url', motivo: 'duplicado', msg: msgDup(dup) }, 409, { doc_existente: dup.id });
  var now = iso(), quem = nomeDe(s), resp = opts.responsavel || quem;
  var ins;
  try {
    ins = await db.prepare('INSERT INTO card_documents (card_id, title, doc_type, url, url_norm, version, note, parent_id, responsible, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(cardId, c.title, c.doc_type, c.url, c.url_norm, c.version || null, c.note || null, pai ? pai.id : null, resp, quem, now, quem, now).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return recusa(env, s, cardId, { campo: 'url', motivo: 'duplicado', msg: 'Este link já está neste card.' }, 409);
    throw e;
  }
  var novo = await lerDoc(env, ins.meta.last_row_id);
  await registrar(env, s, novo, 'create', null, novo, null);
  var todos = await db.prepare('SELECT * FROM card_documents WHERE card_id = ?').bind(cardId).all(), melhor = marcarAtuais(todos.results || []);
  var dto = docDTO(novo, { leitura: !!opts.leitura, atual: melhor[novo.doc_type] && melhor[novo.doc_type].id === novo.id });
  await audit(env, s, 'doc_create', 'document', novo.id, null, { card_id: cardId, title: novo.title, doc_type: novo.doc_type, version: novo.version }, req);
  return json(Object.assign({ ok: true }, dto));
}

/* PATCH /api/docs/:id  { title?, url?, version?, note? } — tipo e versão-pai não mudam (para mudar o tipo, crie outro item). Nunca sobrescreve em silêncio. */
export async function editarDoc(env, s, id, b, req) {
  var d = await lerDoc(env, id);
  if (!d || d.removed_at || !(await cardAtivo(env, d.card_id))) return json({ erro: 'Documento não encontrado.', error: 'not_found' }, 404);
  if (b.doc_type !== undefined && b.doc_type !== d.doc_type) return recusa(env, s, d.card_id, { campo: 'doc_type', motivo: 'tipo_imutavel', msg: 'O tipo não muda depois de salvo. Crie um novo documento do tipo certo.' }, 400);
  if (b.parent_id !== undefined && (b.parent_id || null) !== (d.parent_id || null)) return recusa(env, s, d.card_id, { campo: 'parent_id', motivo: 'pai_imutavel', msg: 'A versão anterior não muda depois de salva.' }, 400);
  var v = validarCampos({ title: b.title, url: b.url, version: b.version, note: b.note }, false); if (v.erro) return recusa(env, s, d.card_id, v.erro, 400);
  var c = v.campos; delete c.doc_type;
  var mexe = Object.keys(c).filter(function (k) { return k !== 'url_norm' && (c[k] || null) !== (d[k] || null); });
  if (!mexe.length) return recusa(env, s, d.card_id, { campo: 'geral', motivo: 'sem_mudanca', msg: 'Nada mudou para salvar.' }, 400);
  if (c.url_norm && c.url_norm !== d.url_norm) {
    var dup = await acharDuplicata(env, d.card_id, c.url_norm, d.id);
    if (dup) return recusa(env, s, d.card_id, { campo: 'url', motivo: 'duplicado', msg: msgDup(dup) }, 409, { doc_existente: dup.id });
  }
  var now = iso(), quem = nomeDe(s);
  var novo = { title: 'title' in c ? c.title : d.title, url: 'url' in c ? c.url : d.url, url_norm: 'url_norm' in c ? c.url_norm : d.url_norm,
    version: 'version' in c ? c.version : d.version, note: 'note' in c ? c.note : d.note };
  try {
    await dataDB(env).prepare('UPDATE card_documents SET title = ?, url = ?, url_norm = ?, version = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .bind(novo.title, novo.url, novo.url_norm, novo.version || null, novo.note || null, quem, now, id).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return recusa(env, s, d.card_id, { campo: 'url', motivo: 'duplicado', msg: 'Este link já está neste card.' }, 409);
    throw e;
  }
  var depois = await lerDoc(env, id);
  await registrar(env, s, d, 'edit', d, depois, null);
  await audit(env, s, 'doc_update', 'document', id, foto(d), foto(depois), req);
  var todos = await dataDB(env).prepare('SELECT * FROM card_documents WHERE card_id = ?').bind(d.card_id).all(), melhor = marcarAtuais(todos.results || []);
  return json(Object.assign({ ok: true }, docDTO(depois, { atual: melhor[depois.doc_type] && melhor[depois.doc_type].id === id })));
}

/* POST /api/docs/:id/remove  { reason } — remoção lógica. Nunca apaga a linha. */
export async function removerDoc(env, s, id, b, req) {
  var d = await lerDoc(env, id);
  if (!d || !(await cardAtivo(env, d.card_id))) return json({ erro: 'Documento não encontrado.', error: 'not_found' }, 404);
  if (d.removed_at) return json({ erro: 'Este documento já foi removido.', error: 'ja_removido' }, 409);
  var motivo = limpaTexto(b && b.reason);
  if (!motivo) return recusa(env, s, d.card_id, { campo: 'reason', motivo: 'motivo', msg: 'Diga o motivo da remoção.' }, 400);
  if (motivo.length > LIM.motivo) return recusa(env, s, d.card_id, { campo: 'reason', motivo: 'motivo_longo', msg: 'Motivo longo demais (máx. ' + LIM.motivo + ').' }, 400);
  var now = iso(), quem = nomeDe(s);
  await dataDB(env).prepare('UPDATE card_documents SET removed_at = ?, removed_by = ?, removal_reason = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(now, quem, motivo, quem, now, id).run();
  var depois = await lerDoc(env, id);
  await registrar(env, s, d, 'remove', d, depois, motivo);
  await audit(env, s, 'doc_remove', 'document', id, foto(d), { removed: true, reason: motivo }, req);
  return json({ ok: true, id: id, removed_at: now, removed_by: quem, removal_reason: motivo });
}
