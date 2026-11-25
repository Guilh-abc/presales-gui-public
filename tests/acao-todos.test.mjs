// Item 5: "o que exige ação" sem corte escondido.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, board, congelarRelogio } from './helpers/harness.mjs';

test('summary: 12 por padrão (compatível), total informado e ?action_all=1 traz todos', async () => {
  const volta = congelarRelogio(); try {
    const h = await montar();
    const b = board();
    // garante mais de 12 candidatos: 20 cards abertos a mais
    for (let i = 0; i < 20; i++) b.projects[0].tasks.push({ id: 900 + i, title: 'extra ' + i, description: '', status: 'todo', tags: 'stage:hold', comments: [] });
    await h.call('/sync/push', { method: 'POST', as: 'sync', body: b });
    const pad = (await h.call('/api/summary')).body;
    assert.equal(pad.action_now.length, 12);
    assert.ok(pad.action_now_total > 12);
    const all = (await h.call('/api/summary?action_all=1')).body;
    assert.equal(all.action_now.length, pad.action_now_total);
    assert.deepEqual(all.action_now.slice(0, 12), pad.action_now, 'mesma ordem: atrasados primeiro');
    const iAtr = all.action_now.findLastIndex(a => a.reasons.includes('atrasado'));
    assert.ok(all.action_now.slice(0, iAtr + 1).every(a => a.reasons.includes('atrasado')), 'nenhum atrasado fica depois de um não atrasado');
  } finally { volta(); }
});

test('painel pede a lista completa e o botão "Ver todos" existe', () => {
  const ds = fs.readFileSync(new URL('../public/js/data-source.js', import.meta.url), 'utf8');
  assert.match(ds, /\/api\/summary\?action_all=1/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="acao-mais"[^>]*>Ver todos</);
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /"Ver todos \(" \+ all\.length \+ "\)"/);
});

test('scripts/test.sh existe, é executável e está documentado', () => {
  const f = new URL('../scripts/test.sh', import.meta.url);
  assert.ok(fs.existsSync(f)); assert.ok(fs.statSync(f).mode & 0o111);
  assert.match(fs.readFileSync(new URL('../LEIA-ME.md', import.meta.url), 'utf8'), /scripts\/test\.sh/);
});
