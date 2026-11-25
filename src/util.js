/* presales-kanzo · src/util.js — Utilitários puros: tempo, base64, hex, sha256, comparação em tempo constante. */
'use strict';

export var enc = new TextEncoder();

export function agora() { return Math.floor(Date.now() / 1000); }

export function iso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

export function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }

export function ub64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

export function b64u(u8) { return b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }

export function aleatorio(n) { var u = new Uint8Array(n); crypto.getRandomValues(u); return u; }

export async function sha256(txt) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(txt))); }

export function iguais(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

