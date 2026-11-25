// Perfil leitura (09/11): custo, margem e pricing interno não saem da API nem do snapshot para quem não é admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { montar, board, snapshot } from './helpers/harness.mjs';
import '../public/js/kanzo-core.js';
import { snapshotLeituraTexto } from '../src/leitura.js';
import fs from 'node:fs';

const K = globalThis.KanzoCore;
// Card sintético com a MESMA estrutura dos cards reais com pricing interno (valores inventados só para o teste).
const DESC = [
  '**Prazo (Kanzo):** 2026-12-01', '**Saúde:** No prazo', '**Responsáveis:** Guilherme Romio Netto', '**Solução / Escopo:** SATELLITE / Starlink', '',
  '## Proposta comercial (PTC 01/11/2026 — valores oficiais para handover)', '| Item | Valor |', '|---|---:|', '| MRC | R$ 1.000,00 |', '| OTC / Instalação | R$ 500,00 |', '| **TCV (12m)** | **R$ 12.500,00** |', '',
  '## Pricing interno (DTGBS — não vai para peça de cliente)', '**Indicadores**', '- GM: 31% | OR: R$ 111 | TCV Net: R$ 222 | NPV: R$ 333',
  '- Discounted cash flow: POSITIVO | Multa: 5% | OE 30 dias + multa: R$ 444', '', '**Governança (custo)**', '- PMO: MRC R$ 555', '',
  '**Net (margem 30%) — blocos**', '- Operacional net: MRC R$ 666', '',
  '## Necessidade do cliente (Planner)', 'Migração de antenas.', '- Margem de 25%, mantida, sem redução.', '- Proposta ao cliente, sem custo, margem nem impostos',
  'OTC   MRC   Total Cost', ' R$ 777       R$ 888   R$ 999 ', '', '**Custo fornecedor Claro (deck)**', '- Setup/NRC: R$ 1.234 | MRC: R$ 5.678', '',
  '## Valores ao cliente (deck = gross do print)', '| Item | Valor |', '|---|---:|', '| MRC | R$ 1.000,00 |', '',
  '- Print net/gross anexado (OTC/MRC/total net ≈ R$ 1 / R$ 2 / R$ 3)'
].join('\n');
const PROIBIDO = /GM:|NPV|TCV Net|OE 30|PMO: MRC|R\$ 555|R\$ 666|Margem de 25|R\$ 777|R\$ 1\.234|R\$ 5\.678|net ≈|Governança \(custo\)|Pricing interno/;

test('descricaoLeitura: corta custo/margem/pricing interno e mantém escopo, responsáveis e preço ao cliente', () => {
  const l = K.descricaoLeitura(DESC);
  assert.doesNotMatch(l, PROIBIDO);
  for (const ok of ['**Solução / Escopo:** SATELLITE / Starlink', '**Responsáveis:** Guilherme Romio Netto', '**Prazo (Kanzo):** 2026-12-01', '| **TCV (12m)** | **R$ 12.500,00** |', '## Valores ao cliente', 'Migração de antenas.', 'Proposta ao cliente, sem custo, margem nem impostos'])
    assert.ok(l.includes(ok), 'manteve: ' + ok);
  assert.match(l, /trecho interno \(custo\/margem\/pricing\) omitido/);
  assert.deepEqual(K.valoresApi(l), K.valoresApi(DESC), 'TCV/MRC/OTC iguais');
  assert.equal(K.descricaoLeitura('Texto sem nada sensível.\nOutra linha 123.'), 'Texto sem nada sensível.\nOutra linha 123.');
});

test('cards reais do snapshot: o corte nunca muda TCV/MRC/OTC, prazo, solução nem responsáveis', () => {
  for (const c of snapshot().cards) {
    const l = K.descricaoLeitura(c.description || '');
    assert.deepEqual(K.valoresApi(l), K.valoresApi(c.description || ''), 'valores do card ' + c.id);
    assert.deepEqual(K.prazos(l), K.prazos(c.description || ''), 'prazo do card ' + c.id);
    assert.equal(K.solutionFromDescription(l), K.solutionFromDescription(c.description || ''), 'solução do card ' + c.id);
    assert.doesNotMatch(l, /margem de \d|\bGM:\s*\d|NPV:\s*R\$|net ≈ R\$/i, 'card ' + c.id);
  }
});

async function cenario() {
  const h = await montar({ entry: 'main.js' });
  const b = board(); b.projects[0].tasks.push({ id: 9001, key: 'pre-vendas#9001', title: 'TESTE PRICING', description: DESC, status: 'doing', tags: 'stage:ganho-handoff', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', comments: [] });
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: b })).status, 200);
  return h;
}

test('API: leitura recebe a descrição cortada, admin recebe tudo; valores iguais nos dois perfis', async () => {
  const h = await cenario();
  const va = (await h.call('/api/cards?limit=500', { as: 'admin' })).body.cards.find(c => c.id === 9001);
  const vv = (await h.call('/api/cards?limit=500', { as: 'viewer' })).body.cards.find(c => c.id === 9001);
  assert.equal(va.description, DESC, 'admin vê a descrição completa');
  assert.doesNotMatch(vv.description, PROIBIDO, 'leitura sem custo/margem na lista');
  assert.deepEqual(vv.values, va.values);
  const uv = (await h.call('/api/cards/9001', { as: 'viewer' })).body, ua = (await h.call('/api/cards/9001', { as: 'admin' })).body;
  assert.doesNotMatch(uv.description, PROIBIDO, 'leitura sem custo/margem no detalhe'); assert.equal(ua.description, DESC);
  const sv = (await h.call('/api/summary', { as: 'viewer' })).body, sa = (await h.call('/api/summary', { as: 'admin' })).body;
  assert.equal(sv.totals.tcv, sa.totals.tcv, 'resumo igual');
  assert.doesNotMatch(JSON.stringify(sv), PROIBIDO);
});

test('API: busca da leitura não vira oráculo de custo/margem; admin continua buscando tudo', async () => {
  const h = await cenario();
  assert.equal((await h.call('/api/cards?q=' + encodeURIComponent('TCV Net'), { as: 'viewer' })).body.cards.length, 0);
  assert.equal((await h.call('/api/cards?q=' + encodeURIComponent('TCV Net'), { as: 'admin' })).body.cards.length, 1);
  assert.equal((await h.call('/api/cards?q=' + encodeURIComponent('Migração de antenas'), { as: 'viewer' })).body.cards.length, 1);
});

test('snapshot de fallback: leitura recebe versão cortada; admin recebe o arquivo original', async () => {
  const h = await montar({ entry: 'main.js' });
  const orig = fs.readFileSync(new URL('../public/js/dados-kanzo.js', import.meta.url), 'utf8');
  const rv = await h.call('/js/dados-kanzo.js', { as: 'viewer' }), ra = await h.call('/js/dados-kanzo.js', { as: 'admin' });
  assert.equal(rv.status, 200); assert.match(rv.headers.get('Content-Type'), /javascript/);
  assert.equal(ra.text, orig);
  assert.equal(rv.text, snapshotLeituraTexto(orig));
  assert.doesNotMatch(rv.text, /Margem de \d|net\/gross anexado[^"]*R\$/);
  assert.equal((await h.call('/js/dados-kanzo.js', { as: 'anon' })).status, 401);
});

test('Etapa A: comentários com custo/margem/pricing interno chegam cortados à leitura; admin vê o texto inteiro', async () => {
  const h = await montar({ entry: 'main.js' });
  const COM1 = 'Custo do fornecedor: R$ 1.200,00 por terminal. Margem de 32% sobre o MRC.';
  const COM2 = 'Cliente aprovou o escopo de 12 terminais Starlink, reunião na quinta.';
  const b = board(); b.projects[0].tasks.push({ id: 9002, key: 'pre-vendas#9002', title: 'TESTE COMENTARIO', description: 'Escopo: 12 terminais.', status: 'doing', tags: 'stage:apresentacao-executiva', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
    comments: [{ id: 1, author: 'Gui', body: COM1, created_at: '2026-11-02T12:00:00Z' }, { id: 2, author: 'Gui', body: COM2, created_at: '2026-11-03T12:00:00Z' }] });
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: b })).status, 200);
  const ua = (await h.call('/api/cards/9002', { as: 'admin' })).body, uv = (await h.call('/api/cards/9002', { as: 'viewer' })).body;
  assert.equal(ua.comments.length, 2, 'comentários chegaram');
  assert.ok(ua.comments.some(c => c.body === COM1), 'admin vê o comentário de custo inteiro');
  assert.equal(uv.comments.length, 2, 'leitura vê os mesmos comentários (só o trecho sai)');
  assert.doesNotMatch(JSON.stringify(uv.comments), /1\.200,00|32%|Margem de/i, 'leitura sem custo/margem nos comentários');
  assert.ok(uv.comments.some(c => c.body === COM2), 'comentário sem dado interno fica igual');
});
