// Integração com o Worker REAL rodando local (wrangler dev --local, D1 simulado). Não toca produção.
// Roda só com KV3_API definido, ex.: KV3_API=http://127.0.0.1:8787 node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const API = process.env.KV3_API;
const SKIP = !API && 'defina KV3_API para rodar contra o wrangler dev --local';
const SYNC = { 'X-Presales-Sync-Token': 'dev-local-sync-token-teste', 'Content-Type': 'application/json' };
const ADM = { Cookie: '__Host-mco=devAdminSessaoLocal_' + 'a'.repeat(24), Origin: API, 'X-MCO': '1', 'Content-Type': 'application/json' };
const VIEW = { Cookie: '__Host-mco=devViewerSessaoLocal' + 'b'.repeat(24), Origin: API, 'X-MCO': '1', 'Content-Type': 'application/json' };
const board = () => JSON.parse(fs.readFileSync(new URL('../dev/.board.json', import.meta.url), 'utf8'));
const j = async (path, opt = {}) => { const r = await fetch(API + path, opt); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
const push = (b) => j('/sync/push', { method: 'POST', headers: SYNC, body: JSON.stringify(Object.assign(b, { exported_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), hostname: 'teste' })) });
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('push do Mac não descarta edição web pendente (antes: superseded e perdida)', { skip: SKIP }, async () => {
  const b = board(); await push(b);
  const antes = (await j('/api/cards/3', { headers: ADM })).body;
  const desc = antes.description + '\n**Próxima ação:** teste integração ' + Date.now();
  const r = await j('/api/cards/3', { method: 'PATCH', headers: ADM, body: JSON.stringify({ description: desc, expect_description_sha256: sha(antes.description) }) });
  assert.equal(r.status, 200); assert.equal(r.body.pending, true);
  await push(board()); // Mac empurra o quadro dele, que ainda não tem a edição
  const depois = (await j('/api/cards/3', { headers: ADM })).body;
  assert.equal(depois.description, desc, 'espelho mantém a edição');
  assert.equal(depois.pending, true);
  const pull = (await j('/sync/pull', { headers: SYNC })).body;
  const cmd = pull.commands.find(c => c.payload.description === desc);
  assert.ok(cmd, 'comando continua na fila para o Mac');
  assert.equal(cmd.payload.base_description_sha256, sha(antes.description));
  // Mac aplica, dá ack e empurra
  const b2 = board(); b2.projects[0].tasks.find(t => t.id === 3).description = desc;
  await j('/sync/ack', { method: 'POST', headers: SYNC, body: JSON.stringify({ ids: pull.commands.map(c => c.id), results: pull.commands.map(() => ({ ok: true })) }) });
  await push(b2);
  const fim = (await j('/api/cards/3', { headers: ADM })).body;
  assert.equal(fim.description, desc); assert.equal(fim.pending, false);
  // volta o quadro ao original para não sujar outros testes
  await push(board());
});

test('conflito: PATCH com hash antigo devolve 409 e o card atual', { skip: SKIP }, async () => {
  const r = await j('/api/cards/4', { method: 'PATCH', headers: ADM, body: JSON.stringify({ description: 'x', expect_description_sha256: 'f'.repeat(64) }) });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'conflict'); assert.ok(r.body.current && r.body.current.id === 4);
});

test('histórico do card: quem mudou o quê e quando', { skip: SKIP }, async () => {
  const c = (await j('/api/cards/5', { headers: ADM })).body;
  const desc = c.description.replace(/\*\*Responsáveis:\*\*[^\n]*/, '**Responsáveis:** Guilherme Romio Netto');
  await j('/api/cards/5', { method: 'PATCH', headers: ADM, body: JSON.stringify({ description: desc, expect_description_sha256: sha(c.description) }) });
  const a = (await j('/api/cards/5/audit', { headers: ADM })).body;
  const ev = a.events[0];
  assert.equal(ev.by, 'Guilherme'); assert.ok(ev.at);
  assert.ok(ev.changes.some(x => x.campo === 'Responsáveis' && x.depois === 'Guilherme Romio Netto'), JSON.stringify(ev.changes));
  assert.ok(a.commands[0].status === 'pending');
});

test('viewer continua sem poder escrever', { skip: SKIP }, async () => {
  const r = await j('/api/cards/5', { method: 'PATCH', headers: VIEW, body: JSON.stringify({ description: 'x' }) });
  assert.equal(r.status, 403);
});

test('values (TCV/MRC/OTC) continuam vindo da tabela markdown, inclusive após edição pendente', { skip: SKIP }, async () => {
  const b = board(); await push(b);
  const lista = (await j('/api/cards?limit=500', { headers: ADM })).body;
  const cards = Array.isArray(lista) ? lista : lista.cards;
  const alvo = cards.find(c => /\|\s*TCV[^|]*\|\s*R\$/i.test((c.description || '').replace(/\*/g, '')));
  assert.ok(alvo, 'existe card com linha de TCV em tabela no quadro');
  const linha = alvo.description.split('\n').map(l => l.replace(/\*/g, '')).filter(l => /^\s*\|\s*TCV/i.test(l)).pop();
  const nums = linha.match(/R\$\s*-?[\d.]+(?:,\d+)?/g); const esperado = Number(nums[nums.length - 1].replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.'));
  assert.equal(alvo.values.tcv, esperado, 'TCV extraído da tabela');
  // edição pendente + push do Mac: values recalculados sobre a descrição reaplicada
  const desc = alvo.description + '\n**Próxima ação:** teste values ' + Date.now();
  const r = await j('/api/cards/' + alvo.id, { method: 'PATCH', headers: ADM, body: JSON.stringify({ description: desc, expect_description_sha256: sha(alvo.description) }) });
  assert.equal(r.status, 200); assert.equal(r.body.values.tcv, esperado);
  await push(board());
  const depois = (await j('/api/cards/' + alvo.id, { headers: ADM })).body;
  assert.equal(depois.values.tcv, esperado); assert.equal(depois.description, desc);
  // limpa: descarta o comando de teste aplicando-o no "Mac" simulado sem salvar e repõe o quadro
  const pull = (await j('/sync/pull', { headers: SYNC })).body;
  await j('/sync/ack', { method: 'POST', headers: SYNC, body: JSON.stringify({ ids: pull.commands.map(c => c.id), results: pull.commands.map(() => ({ ok: true })) }) });
  await push(board());
});

test('create pela nuvem → ack com real_id → delete resolve temp_id e some do espelho', { skip: SKIP }, async () => {
  const b = board(); await push(b);
  const title = '__test_idmap_create_delete__ ' + Date.now();
  const created = await j('/api/cards', { method: 'POST', headers: ADM, body: JSON.stringify({ title, status: 'todo', stage: 'hold' }) });
  assert.equal(created.status, 200);
  const tempId = created.body.id;
  assert.ok(tempId >= 100000, 'id temporário da nuvem');
  assert.equal(created.body.pending, true);
  const pull = (await j('/sync/pull', { headers: SYNC })).body;
  const cmd = pull.commands.find(c => c.op === 'create_task' && c.payload && c.payload.title === title);
  assert.ok(cmd, 'create_task na fila');
  assert.equal(cmd.payload.temp_id, tempId);
  // Mac simulado: cria com id real 901 e devolve mapa no ack
  const realId = 901;
  const realKey = 'pre-vendas#901';
  const ack = await j('/sync/ack', { method: 'POST', headers: SYNC, body: JSON.stringify({
    ids: [cmd.id],
    results: [{ ok: true, op: 'create_task', out: 'Created ' + realKey + ' in todo: ' + title, temp_id: tempId, real_id: realId, real_key: realKey }]
  }) });
  assert.equal(ack.status, 200);
  assert.equal(ack.body.id_maps, 1);
  // espelho: card temp marcado deleted; delete pela nuvem usando o temp_id resolve para o real
  const del = await j('/api/cards/' + tempId, { method: 'DELETE', headers: ADM });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.resolved_id, realId);
  assert.equal(del.body.mapped_from, tempId);
  const pull2 = (await j('/sync/pull', { headers: SYNC })).body;
  const delCmd = pull2.commands.find(c => c.op === 'delete_task');
  assert.ok(delCmd, 'delete_task na fila');
  assert.equal(delCmd.payload.id, realKey, 'payload aponta ao id real do Mac');
  assert.equal(delCmd.payload.expected_title, title, 'expected_title do card criado');
  assert.ok(delCmd.payload.expected_description_sha256, 'hash da descrição no delete');
  // Mac aplica delete e empurra quadro sem o card
  await j('/sync/ack', { method: 'POST', headers: SYNC, body: JSON.stringify({ ids: pull2.commands.map(c => c.id), results: pull2.commands.map(() => ({ ok: true })) }) });
  const b2 = board();
  // garantir que 901 não está no board simulado
  await push(b2);
  const lista = (await j('/api/cards?limit=500', { headers: ADM })).body;
  const cards = Array.isArray(lista) ? lista : lista.cards;
  assert.ok(!cards.some(c => c.title === title && !c.deleted_at), 'card de teste não aparece ativo');
});
