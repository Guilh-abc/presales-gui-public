// Reproduz o caso CLIENTE DELTA F200G de 17/11/2026: valores gravados nos campos
// e depois apagados quando a etapa foi para ganho-handoff com uma descrição velha.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { montar, board, sha } from './helpers/harness.mjs';

const DESC_VELHA = [
  '**Solução / Escopo:** DIA e L2L 1 Gbps · FortiGate 200G com UTP',
  '**Estágio Planner:** Desenvolvimento proposta → `stage:processo-aprovacao-precificacao`',
  '**Saúde:** No prazo',
  '**Situação atual:** Pricing L2L e cotação Fortinet atualizada em 05/11.',
  '**Responsáveis:** Guilherme Romio Netto',
  '**Prazo (Kanzo):** 2026-11-11',
  '**Próxima ação:** Aguardando cliente'
].join('\n');

const DESC_BOA = DESC_VELHA.replace(
  'DIA e L2L 1 Gbps · FortiGate 200G com UTP',
  'FortiGate 200G com UTP + frete - locacao. Fornecedor Ingram'
) + '\n\n**Valores (Kanzo):**\n| Item | Valor |\n|---|---|\n| TCV | R$ 324.508,00 |\n| MRC | R$ 9.014,13 / mês |';

function drawerPatch() {
  const ctx = { window: {}, globalThis: null };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const fim = src.indexOf('\n(function () {');
  vm.runInContext(src.slice(0, fim), ctx, { filename: 'public/js/app.js' });
  return ctx.KanzoDrawerPatch;
}

async function cardCliente Delta(h) {
  const push = await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  assert.equal(push.status, 200, push.text);
  const cr = await h.call('/api/cards', { method: 'POST', body: { title: 'CLIENTE DELTA F200G', stage: 'apresentacao-executiva', status: 'done', description: DESC_BOA } });
  assert.equal(cr.status, 200, cr.text);
  return cr.body;
}

test('front: mudar etapa só envia {stage}, nunca a descrição', () => {
  const P = drawerPatch();
  const patch = P.patchMoverEtapa('ganho-handoff');
  assert.equal(patch.stage, 'ganho-handoff');
  assert.deepEqual(Object.keys(patch), ['stage']);
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /var patch = window\.KanzoDrawerPatch\.patchMoverEtapa\(stage\);/);
  assert.doesNotMatch(app, /var patch = \{ stage: stage \}/);
});

test('front: Salvar só reenvia #f-desc se o usuário editou o texto avançado (caso de ontem)', () => {
  const P = drawerPatch();
  const prev = { title: 'CLIENTE DELTA F200G', status: 'done', stage: 'apresentacao-executiva', description: DESC_BOA };
  /* Drawer aberto com a descrição velha; os campos já gravaram TCV/MRC em prev.description. */
  const semEditar = P.patchSalvarDrawer({
    prev: prev, title: prev.title, descHabilitada: true, descNovo: DESC_VELHA, descInicial: DESC_VELHA
  });
  assert.deepEqual(Object.keys(semEditar), []);
  assert.equal(semEditar.description, undefined);
  assert.equal(semEditar.stage, undefined);

  const soTitulo = P.patchSalvarDrawer({
    prev: prev, title: 'CLIENTE DELTA F200G atualizado', descHabilitada: true, descNovo: DESC_VELHA, descInicial: DESC_VELHA
  });
  assert.equal(soTitulo.title, 'CLIENTE DELTA F200G atualizado');
  assert.deepEqual(Object.keys(soTitulo), ['title']);
  assert.equal(soTitulo.description, undefined);

  const editouAvancado = P.patchSalvarDrawer({
    prev: prev, title: prev.title, descHabilitada: true, descNovo: DESC_BOA + '\n', descInicial: DESC_VELHA
  });
  assert.equal(editouAvancado.description, DESC_BOA + '\n');
  assert.equal(editouAvancado.stage, undefined);

  /* O bug antigo comparava #f-desc com prev.description e reenviava o texto velho. */
  assert.equal(DESC_VELHA !== prev.description, true);
});

test('API: só mudar a etapa preserva TCV/MRC (reprodução do card 53)', async () => {
  const h = await montar();
  const criado = await cardCliente Delta(h);
  assert.equal(criado.values.tcv, 324508);
  assert.equal(criado.values.mrc, 9014.13);
  assert.equal(criado.values.otc == null, true);

  const r = await h.call('/api/cards/' + criado.id, { method: 'PATCH', body: { stage: 'ganho-handoff' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.stage, 'ganho-handoff');
  assert.equal(r.body.status, 'done');
  assert.equal(r.body.description, DESC_BOA);
  assert.equal(r.body.values.tcv, 324508);
  assert.equal(r.body.values.mrc, 9014.13);
  assert.equal(r.body.values.otc == null, true);
});

test('API: PATCH com descrição velha + etapa ganho não apaga os valores (hash defasado ou ausente = 409)', async () => {
  const h = await montar();
  const criado = await cardCliente Delta(h);
  const id = criado.id;

  const semHash = await h.call('/api/cards/' + id, { method: 'PATCH', body: { stage: 'ganho-handoff', description: DESC_VELHA } });
  assert.equal(semHash.status, 409);
  assert.equal(semHash.body.error, 'conflict');

  const hashVelho = await h.call('/api/cards/' + id, { method: 'PATCH', body: { stage: 'ganho-handoff', description: DESC_VELHA, expect_description_sha256: sha(DESC_VELHA) } });
  assert.equal(hashVelho.status, 409);
  assert.equal(hashVelho.body.error, 'conflict');

  const ainda = (await h.call('/api/cards/' + id)).body;
  assert.equal(ainda.description, DESC_BOA);
  assert.equal(ainda.values.tcv, 324508);
  assert.equal(ainda.stage, 'apresentacao-executiva');
});

test('API: PATCH de descrição com hash atual grava; sem hash ou defasado, 409', async () => {
  const h = await montar();
  const push = await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  assert.equal(push.status, 200, push.text);
  const cr = await h.call('/api/cards', { method: 'POST', body: { title: 'TESTE HASH', stage: 'precificacao', description: 'texto base' } });
  assert.equal(cr.status, 200, cr.text);
  const id = cr.body.id;

  const falta = await h.call('/api/cards/' + id, { method: 'PATCH', body: { description: 'texto novo' } });
  assert.equal(falta.status, 409);
  assert.equal(falta.body.error, 'conflict');
  assert.equal((await h.call('/api/cards/' + id)).body.description, 'texto base');

  const ok = await h.call('/api/cards/' + id, { method: 'PATCH', body: { description: 'texto novo', expect_description_sha256: sha('texto base') } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.description, 'texto novo');
});
