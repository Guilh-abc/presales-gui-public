/* presales-kanzo · src/http.js — Respostas HTTP com cabeçalhos de segurança (CSP sem unsafe-inline), cookies e leitura de JSON. */
'use strict';
import { COOKIE } from './config.js';

/* Item 4: sem 'unsafe-inline'. Scripts e estilos só de arquivos da própria origem; valores dinâmicos via CSSOM (js/estilos-dinamicos.js). */
export var CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function seguranca(h, tipo) {
  h.set('Content-Security-Policy', CSP); h.set('X-Content-Type-Options', 'nosniff'); h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Frame-Options', 'DENY'); h.set('Strict-Transport-Security', 'max-age=31536000');
  if (tipo !== 'ativo') h.set('Cache-Control', 'no-store'); else h.set('Cache-Control', 'private, no-cache');
  return h;
}

export function json(obj, status, extra) {
  var h = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  if (extra) Object.keys(extra).forEach(function (k) { h.append(k, extra[k]); });
  return new Response(JSON.stringify(obj), { status: status || 200, headers: seguranca(h) });
}

export function html(corpo, status) { return new Response(corpo, { status: status || 200, headers: seguranca(new Headers({ 'Content-Type': 'text/html; charset=utf-8' })) }); }

export function js(corpo) { return new Response(corpo, { headers: seguranca(new Headers({ 'Content-Type': 'text/javascript; charset=utf-8' })) }); }

export function css(corpo) { return new Response(corpo, { headers: seguranca(new Headers({ 'Content-Type': 'text/css; charset=utf-8' })) }); }
export function redirecionar(url, status) { return new Response(null, { status: status || 302, headers: seguranca(new Headers({ Location: url })) }); }

export function cookieSessao(token, seg) { return COOKIE + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + seg; }

export function lerCookie(req) {
  var c = req.headers.get('Cookie') || '', m = c.split(/;\s*/);
  for (var i = 0; i < m.length; i++) { var p = m[i].split('='); if (p[0] === COOKIE) return p.slice(1).join('='); }
  return '';
}

export function mesmaOrigem(req) { var o = req.headers.get('Origin'); return !!o && o === new URL(req.url).origin; }

export async function corpoJson(req) {
  if (!/^application\/json/i.test(req.headers.get('Content-Type') || '')) return null;
  var t = await req.text(); if (t.length > 500000) return null;
  try { var o = JSON.parse(t); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}

