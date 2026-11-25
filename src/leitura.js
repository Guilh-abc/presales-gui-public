/* presales-kanzo · src/leitura.js — Perfil leitura: snapshot de fallback (/js/dados-kanzo.js) sem custo, margem nem pricing interno.
   Usa as mesmas regras do corte da API (K.descricaoLeitura, módulo único public/js/kanzo-core.js). */
'use strict';
import { K } from './format.js';
import { seguranca } from './http.js';

var cache = null; // { orig: tamanho do original, corpo: texto cortado }
var PREFIXO = 'window.KANZO_SNAPSHOT = ';

export function limparSnapshot(obj) {
  (function anda(o, chave) {
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) { if (typeof o[i] === 'string') o[i] = K.trechoLeitura(o[i]); else anda(o[i]); } return; }
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === 'string') o[k] = (k === 'description' || k === 'summary' || k === 'body' || k === 'comment' || k === 'text') ? K.descricaoLeitura(v) : K.trechoLeitura(v);
      else anda(v, k);
    });
  })(obj);
  return obj;
}

export function snapshotLeituraTexto(texto) {
  var t = String(texto || '').trim();
  if (t.indexOf(PREFIXO) !== 0) return 'window.KANZO_SNAPSHOT = null;\n';
  var corpo = t.slice(PREFIXO.length).replace(/;\s*$/, '');
  var obj; try { obj = JSON.parse(corpo); } catch (e) { return 'window.KANZO_SNAPSHOT = null;\n'; }
  return PREFIXO + JSON.stringify(limparSnapshot(obj)) + ';\n';
}

export async function snapshotLeitura(env, req) {
  var a = await env.ASSETS.fetch(new Request(new URL('/js/dados-kanzo.js', req.url).href));
  if (a.status !== 200) return new Response('Not found', { status: 404, headers: seguranca(new Headers(), 'ativo') });
  var texto = await a.text();
  if (!cache || cache.orig !== texto.length) cache = { orig: texto.length, corpo: snapshotLeituraTexto(texto) };
  var h = seguranca(new Headers({ 'Content-Type': 'text/javascript; charset=utf-8' }), 'ativo');
  return new Response(req.method === 'HEAD' ? null : cache.corpo, { status: 200, headers: h });
}
