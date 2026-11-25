import base from './worker.js';
import ARQ from './assets.js';
var gzCache = new Map(), plainCache = new Map();
function gzBytes(p) { var b = gzCache.get(p); if (!b) { var bin = atob(ARQ[p].g), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); gzCache.set(p, b = u); } return b; }
async function plano(p) { var u = plainCache.get(p); if (!u) { var r = new Response(new Blob([gzBytes(p)]).stream().pipeThrough(new DecompressionStream('gzip'))); u = new Uint8Array(await r.arrayBuffer()); plainCache.set(p, u); } return u; }
var ASSETS = { async fetch(req) {
  var p = new URL(req.url).pathname; if (p === '/') p = '/index.html';
  if (!Object.prototype.hasOwnProperty.call(ARQ, p)) return new Response('Not found', { status: 404 });
  var u = await plano(p);
  return new Response(req.method === 'HEAD' ? null : u, { status: 200, headers: { 'Content-Type': ARQ[p].t, 'Content-Length': String(u.length) } });
} };
export default { fetch: function (req, env, ctx) { return base.fetch(req, Object.assign({}, env, { ASSETS: ASSETS }), ctx); },
  scheduled: function (ev, env, ctx) { return base.scheduled(ev, env, ctx); } };
