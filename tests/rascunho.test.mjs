// Item 4 — rascunho de pricing e esqueleto de proposta a partir do card (só admin, não grava nada).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, board } from './helpers/harness.mjs';

const DESC_GM = ['## Escopo', '- 3 links DIA 100 Mbps', '', '## Pricing interno', '- Custo total: R$ 10.000,00', '- GM 24% sobre o custo', '- Gross-up 22,18% (FUST/PIS/COFINS/ICMS)', '',
  '## Valores ao cliente', '| Item | Valor |', '|---|---:|', '| MRC | R$ 2.000,00 |', '| **TCV (24m)** | **R$ 48.000,00** |'].join('\n');
async function cenario() {
  const h = await montar(); const b = board();
  b.projects[0].tasks.push({ id: 9200, key: 'pre-vendas#9200', title: 'ACME - Links DIA', description: DESC_GM, status: 'doing', tags: 'stage:precificacao', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', comments: [] });
  b.projects[0].tasks.push({ id: 9201, key: 'pre-vendas#9201', title: 'SEMVALOR - Projeto', description: 'Só uma nota, sem valores.', status: 'todo', tags: 'stage:recebimento-do-projeto', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', comments: [] });
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: b })).status, 200);
  return h;
}
const conta = (h) => JSON.stringify([h.DATA.db.prepare('SELECT COUNT(*) n FROM pending_commands').get(), h.DATA.db.prepare('SELECT COUNT(*) n FROM audit_log').get(), h.DATA.db.prepare('SELECT id, title, description, status, stage, tags_json FROM cards ORDER BY id').all()]);

test('só admin: leitura 403, anônimo 401, admin 200; nada é gravado (fila, auditoria e cards iguais)', async () => {
  const h = await cenario(); const antes = conta(h);
  for (const q of ['tipo=pricing', 'tipo=proposta', 'tipo=pricing&formato=md', 'tipo=proposta&formato=md']) {
    assert.equal((await h.call('/api/cards/9200/rascunho?' + q, { as: 'viewer' })).status, 403, q);
    assert.equal((await h.call('/api/cards/9200/rascunho?' + q, { as: 'anon' })).status, 401, q);
    assert.equal((await h.call('/api/cards/9200/rascunho?' + q, { as: 'admin' })).status, 200, q);
  }
  assert.equal(conta(h), antes, 'gerar rascunho não grava nada');
});

test('pricing: valores, prazo, GM e gross-up só do que está no card; proposta sem custo/GM/gross-up', async () => {
  const h = await cenario();
  const pr = (await h.call('/api/cards/9200/rascunho?tipo=pricing&formato=md', { as: 'admin' }));
  assert.match(pr.headers.get('content-disposition'), /attachment; filename="pricing-acme-9200\.md"/);
  const md = pr.text;
  assert.match(md, /\| MRC \(R\$\/mês\) \| R\$\s2\.000,00/); assert.match(md, /\| TCV \(R\$\) \| R\$\s48\.000,00/); assert.match(md, /\| Prazo do contrato \(meses\) \| 24 \|/);
  assert.match(md, /\| GM \| 24% \|/); assert.match(md, /\| Gross-up \| 22,18% \|/); assert.match(md, /\| OTC \(R\$\) \| ____ \|/);
  const prop = (await h.call('/api/cards/9200/rascunho?tipo=proposta&formato=md', { as: 'admin' })).text;
  assert.match(prop, /Deutsche Telekom/); assert.match(prop, /3 links DIA 100 Mbps/); assert.match(prop, /R\$\s48\.000,00/);
  assert.doesNotMatch(prop, /\bGM\b|gross|custo|margem|10\.000/i, 'peça de cliente sem dado interno');
  assert.doesNotMatch(prop, /Starlink/i);
});

test('card sem valores: tudo em branco, nada estimado; sem GM/gross-up', async () => {
  const h = await cenario();
  const md = (await h.call('/api/cards/9201/rascunho?tipo=pricing&formato=md', { as: 'admin' })).text;
  assert.match(md, /\| MRC \(R\$\/mês\) \| ____ \|/); assert.match(md, /\| TCV \(R\$\) \| ____ \|/); assert.match(md, /\| Prazo do contrato \(meses\) \| ____ \|/);
  assert.doesNotMatch(md, /\| GM \||\| Gross-up \|/); assert.match(md, /Nada foi estimado/);
  assert.doesNotMatch(md, /R\$\s?\d/, 'nenhum valor em reais inventado');
});

test('Starlink (card real 47): alertas fixos da revenda no pricing e checklist interno na proposta; card não-Starlink sem alerta', async () => {
  const h = await cenario();
  const p47 = (await h.call('/api/cards/47/rascunho?tipo=pricing&formato=md', { as: 'admin' })).text;
  assert.match(p47, /30 dias de aviso/); assert.match(p47, /Terminal Access Charge/); assert.match(p47, /Dados extras.*revendedor/);
  assert.match(p47, /\| Prazo do contrato \(meses\) \| 36 \|/); assert.match(p47, /\| OTC \(R\$\) \| sem OTC \|/);
  const q47 = (await h.call('/api/cards/47/rascunho?tipo=proposta&formato=md', { as: 'admin' })).text;
  assert.match(q47, /Checklist interno Starlink \(remover antes de enviar/); assert.match(q47, /SLA: 99,5%/);
  const p54 = (await h.call('/api/cards/54/rascunho?tipo=pricing&formato=md', { as: 'admin' })).text;
  assert.doesNotMatch(p54, /Starlink|Terminal Access/);
  const q54 = (await h.call('/api/cards/54/rascunho?tipo=proposta&formato=md', { as: 'admin' })).text;
  assert.match(q54, /SLA: ____ \(o card tem valores diferentes/);
});

test('HTML de visualização/impressão sem script nem estilo inline (CSP), conteúdo escapado; botão só para admin no painel', async () => {
  const h = await cenario();
  const r = await h.call('/api/cards/9200/rascunho?tipo=proposta', { as: 'admin' });
  assert.match(r.headers.get('content-type'), /text\/html/); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(r.text, /<script>(?!<)|<script(?![^>]*src=)[^>]*>|style="|<style/);
  assert.match(r.text, /<script src="\/js\/rascunho-print\.js"><\/script>/); assert.match(r.text, /<link rel="stylesheet" href="\/css\/rascunho\.css">/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="drawer-docs" hidden/); assert.match(app, /adm = state\.live && state\.me && state\.me\.papel === "admin"/);
  const hm = await montar({ entry: 'main.js' });
  assert.equal((await hm.call('/js/rascunho-print.js', { as: 'admin' })).status, 200); assert.equal((await hm.call('/css/rascunho.css', { as: 'admin' })).status, 200);
});
