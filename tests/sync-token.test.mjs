// Item 3: rotação do token de sync sem downtime (SYNC_TOKEN + SYNC_TOKEN_NEXT).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, SYNC_TOKEN, SYNC_TOKEN_NEXT } from './helpers/harness.mjs';

const pull = (h, tk) => h.call('/sync/pull', { as: 'anon', headers: tk == null ? {} : { 'X-Presales-Sync-Token': tk } });

test('sem NEXT: só o atual vale (comportamento de hoje)', async () => {
  const h = await montar();
  assert.equal((await pull(h, SYNC_TOKEN)).status, 200);
  assert.equal((await pull(h, SYNC_TOKEN_NEXT)).status, 403);
  assert.equal((await pull(h, '')).status, 403);
  assert.equal((await pull(h, null)).status, 403);
  assert.equal((await pull(h, SYNC_TOKEN + 'x')).status, 403);
  const st = (await h.call('/api/sync/status')).body.sync_token;
  assert.deepEqual(st, { slot_em_uso: 'atual', rotacao_em_andamento: false });
});

test('durante a troca: atual e próximo valem; status diz qual o Mac está usando', async () => {
  const h = await montar({ env: { SYNC_TOKEN_NEXT } });
  assert.equal((await pull(h, SYNC_TOKEN)).status, 200);
  assert.equal((await h.call('/api/sync/status')).body.sync_token.slot_em_uso, 'atual');
  assert.equal((await pull(h, SYNC_TOKEN_NEXT)).status, 200);
  assert.deepEqual((await h.call('/api/sync/status')).body.sync_token, { slot_em_uso: 'proximo', rotacao_em_andamento: true });
  for (const p of ['/sync/push', '/sync/snapshot', '/sync/ack']) {
    const r = await h.call(p, { method: 'POST', as: 'anon', headers: { 'X-Presales-Sync-Token': SYNC_TOKEN_NEXT, 'Content-Type': 'application/json' }, body: p === '/sync/ack' ? { ids: [], results: [] } : { projects: [] } });
    assert.equal(r.status, 200, p);
  }
  assert.equal((await pull(h, 'outro')).status, 403);
});

test('depois da troca (NEXT virou o atual e o antigo saiu): o token antigo para de valer', async () => {
  const h = await montar({ env: { SYNC_TOKEN: SYNC_TOKEN_NEXT, SYNC_TOKEN_NEXT: '' } });
  assert.equal((await pull(h, SYNC_TOKEN)).status, 403);
  assert.equal((await pull(h, SYNC_TOKEN_NEXT)).status, 200);
});

test('sem nenhum token configurado, nada passa (inclusive header vazio)', async () => {
  const h = await montar({ env: { SYNC_TOKEN: '', SYNC_TOKEN_NEXT: '' } });
  assert.equal((await pull(h, '')).status, 403);
  assert.equal((await pull(h, 'x')).status, 403);
});

test('status e respostas nunca expõem o valor do token', async () => {
  const h = await montar({ env: { SYNC_TOKEN_NEXT } });
  await pull(h, SYNC_TOKEN_NEXT);
  for (const p of ['/api/sync/status', '/api/summary', '/api/saude']) {
    const t = (await h.call(p)).text;
    assert.ok(!t.includes(SYNC_TOKEN) && !t.includes(SYNC_TOKEN_NEXT), p);
  }
  const doc = fs.readFileSync(new URL('../LEIA-ME.md', import.meta.url), 'utf8');
  assert.match(doc, /SYNC_TOKEN_NEXT/); assert.match(doc, /Rotação do token de sync/);
});
