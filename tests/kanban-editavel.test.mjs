// Lote 2 nuvem — Kanban editável (admin). Mac simulado; nada no D1 real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, board, sha } from './helpers/harness.mjs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/kanban.css', import.meta.url), 'utf8');

test('UI: quadro, Mover para, modal de criar; sem CDN; delete fora do lote', () => {
  assert.match(html, /id="kanban-board"/);
  assert.match(html, /id="view-board"/);
  assert.match(html, /id="new-modal"/);
  assert.match(html, /kanban\.css/);
  assert.match(app, /function renderKanban/);
  assert.match(app, /function moveCard/);
  assert.match(app, /data-mover/);
  assert.match(app, /KanzoFields\.set\(desc, "prazo"/);
  assert.match(app, /drawer-delete"\)\.hidden = true/);
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /onclick=/);
});

test('API: admin move stage grava D1 + fila + stage_history; viewer 403', async () => {
  const h = await montar();
  assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() })).status, 200);
  const antes = (await h.call('/api/cards/44')).body;
  const r = await h.call('/api/cards/44', { method: 'PATCH', body: { stage: 'fechamento' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.stage, 'fechamento');
  assert.ok(r.body.pending_command_id);
  assert.equal(h.DATA.db.prepare('SELECT kind FROM cloud_writes WHERE card_id=44').get().kind, 'update');
  const sh = h.DATA.db.prepare("SELECT source,to_stage FROM stage_history WHERE card_id=44 AND source!='inicio' ORDER BY id DESC LIMIT 1").get();
  assert.equal(sh.source, 'painel'); assert.equal(sh.to_stage, 'fechamento');
  assert.equal((await h.call('/api/cards/44', { method: 'PATCH', as: 'viewer', body: { stage: 'precificacao' } })).status, 403);
});

test('API: criar com descrição/prazo/saúde; viewer 403; comentário admin', async () => {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  const desc = windowSet('**Saúde:** Atenção\n**Prazo (Kanzo):** 2026-12-01');
  const cr = await h.call('/api/cards', { method: 'POST', body: { title: 'LOTE2 TESTE LOCAL', stage: 'precificacao', description: desc } });
  assert.equal(cr.status, 200, cr.text);
  assert.equal(cr.body.stage, 'precificacao');
  assert.match(cr.body.description, /Atenção/);
  assert.ok(cr.body.id >= 100000);
  assert.equal(h.DATA.db.prepare('SELECT kind FROM cloud_writes WHERE card_id=?').get(cr.body.id).kind, 'create');
  assert.equal((await h.call('/api/cards', { method: 'POST', as: 'viewer', body: { title: 'x' } })).status, 403);
  const cm = await h.call('/api/cards/44/comments', { method: 'POST', body: { body: 'comentário lote2' } });
  assert.equal(cm.status, 200, cm.text);
  assert.equal((await h.call('/api/cards/44/comments', { method: 'POST', as: 'viewer', body: { body: 'x' } })).status, 403);
});

function windowSet(seed) {
  // description already formatted like fields.js would produce
  return seed;
}

test('CSP: kanban.css e modal sem inline no HTML do painel', () => {
  assert.doesNotMatch(html, /onclick=/);
  assert.match(css, /\.kboard\{/);
  assert.match(css, /\.modal\{/);
});
