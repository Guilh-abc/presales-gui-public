// Cenário fixo de chamadas à API. Usado para provar que a API não muda ao dividir o worker.js.
import { board, sha } from './harness.mjs';

export async function rodarCenario(h) {
  const out = [];
  const reg = async (nome, path, opt) => {
    const r = await h.call(path, opt);
    const ct = r.headers.get('Content-Type') || '';
    const corpo = r.body != null ? r.body : (/html|javascript|css/.test(ct) ? '<' + ct.split(';')[0] + '>' : r.text);
    out.push({ nome, status: r.status, ct, location: r.headers.get('Location'), cookie: r.headers.has('Set-Cookie'), corpo });
    return r;
  };
  await reg('saude', '/api/saude', { as: 'anon' });
  await reg('sem login api', '/api/cards', { as: 'anon' });
  await reg('sem login html', '/', { as: 'anon', headers: { Accept: 'text/html' } });
  await reg('sync sem token', '/sync/pull', { as: 'anon' });
  await reg('push', '/sync/push', { method: 'POST', as: 'sync', body: board() });
  await reg('me', '/api/me');
  await reg('me viewer', '/api/me', { as: 'viewer' });
  await reg('status', '/api/sync/status');
  await reg('summary', '/api/summary');
  await reg('stages', '/api/stages');
  await reg('cards', '/api/cards');
  await reg('cards filtro', '/api/cards?status=doing&q=Starlink');
  await reg('card 2', '/api/cards/2');
  await reg('card 999', '/api/cards/999');
  const c3 = (await h.call('/api/cards/3')).body;
  await reg('patch 3', '/api/cards/3', { method: 'PATCH', body: { description: c3.description + '\n**Próxima ação:** teste', expect_description_sha256: sha(c3.description) } });
  await reg('patch conflito', '/api/cards/4', { method: 'PATCH', body: { description: 'x', expect_description_sha256: 'f'.repeat(64) } });
  await reg('patch viewer', '/api/cards/4', { method: 'PATCH', as: 'viewer', body: { description: 'x' } });
  await reg('patch sem origem', '/api/cards/4', { method: 'PATCH', headers: { Origin: 'https://mal.test' }, body: { description: 'x' } });
  await reg('create', '/api/cards', { method: 'POST', body: { title: 'Card novo teste', stage: 'precificacao', description: '| TCV (12m) | R$ 1.000,00 |' } });
  await reg('delete 5', '/api/cards/5', { method: 'DELETE' });
  await reg('comment', '/api/cards/6/comments', { method: 'POST', body: { body: 'oi' } });
  const pull = await reg('pull', '/sync/pull', { as: 'sync' });
  const cmds = pull.body.commands;
  const results = cmds.map(c => c.op === 'create_task' ? { ok: true, op: 'create_task', out: 'criado pre-vendas#77' }
    : c.op === 'delete_task' ? { ok: false, op: 'delete_task', error: "title mismatch: expected 'a' got 'b'", refused: true } : { ok: true, op: c.op });
  await reg('ack', '/sync/ack', { method: 'POST', as: 'sync', body: { ids: cmds.map(c => c.id), results } });
  await reg('push 2', '/sync/push', { method: 'POST', as: 'sync', body: board() });
  await reg('status 2', '/api/sync/status');
  await reg('summary 2', '/api/summary');
  await reg('card 5', '/api/cards/5');
  await reg('audit 3', '/api/cards/3/audit');
  await reg('audit 5', '/api/cards/5/audit');
  await reg('users', '/api/admin/users');
  await reg('users viewer', '/api/admin/users', { as: 'viewer' });
  await reg('products', '/api/products');
  await reg('solutions', '/api/solutions');
  await reg('login page', '/login', { as: 'anon' });
  await reg('login js', '/portal/login.js', { as: 'anon' });
  await reg('admin page', '/admin');
  await reg('login errado', '/api/login', { method: 'POST', as: 'anon', headers: { Origin: 'https://k.test', 'X-MCO': '1', 'Content-Type': 'application/json' }, body: { email: 'ninguem@x', senha: 'x' } });
  await reg('rota sync desconhecida', '/sync/xyz', { as: 'sync' });
  await reg('metodo', '/api/cards/2', { method: 'PUT' });
  return out;
}
