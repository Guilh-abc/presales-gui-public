// Servidor local para conferir o painel num navegador de verdade (D1 simulado, sem produção).
// Uso: node tests/helpers/servidor-local.mjs [porta] [entrada=main.js]  → cookie de admin: __Host-mco=AAAA… (ver harness)
import http from 'node:http';
import { montar, board } from './harness.mjs';

const PORTA = Number(process.argv[2] || 8799), ENTRADA = process.argv[3] || 'main.js';
const h = await montar({ entry: ENTRADA });
await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
// uma exclusão recusada de exemplo (card 8) para conferir o aviso na tela
await h.call('/api/cards/8', { method: 'DELETE' });
const cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
await h.call('/sync/ack', { method: 'POST', as: 'sync', body: { ids: cmds.map(c => c.id), results: [{ ok: false, op: 'delete_task', error: "title mismatch: expected 'x' got 'y'", refused: true }] } });
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await h.worker.fetch(new Request('http://127.0.0.1:' + PORTA + req.url, { method: req.method, headers: req.headers, body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined }), h.env);
  const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
  res.writeHead(r.status, hs); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORTA, '127.0.0.1', () => console.log('pronto http://127.0.0.1:' + PORTA));
