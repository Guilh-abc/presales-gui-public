// Pedido do Guilherme (09/11): seção "04 Simuladores" removida do painel (HTML, JS, CSS e navegação).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('painel sem a seção Simuladores e com seções numeradas 01..05 em sequência', () => {
  const h = rd('public/index.html');
  assert.doesNotMatch(h, /Simulador|simuladores|entradas suas|Calculadoras de apoio|tools\.js|id="b-sim"/);
  assert.deepEqual([...h.matchAll(/<span class="num">(\d+)<\/span>/g)].map(m => m[1]), ['01', '02', '03', '04', '05']);
  const nav = [...h.matchAll(/data-nav="([^"]+)"/g)].map(m => m[1]);
  const secs = [...h.matchAll(/data-sec="([^"]+)"/g)].map(m => m[1]);
  // Remodelo 11/11: Carteira vira o item 1 (com Exige ação); depois Resumo, Funil, Saúde e Qualidade.
  assert.deepEqual(nav, ['carteira', 'resumo', 'funil', 'saude', 'qualidade']);
  assert.deepEqual(nav, secs, 'todo item da navegação aponta para uma seção que existe');
  assert.equal(fs.existsSync(new URL('../public/js/tools.js', import.meta.url)), false);
  assert.doesNotMatch(rd('public/js/app.js'), /KanzoTools/);
  assert.doesNotMatch(rd('public/css/styles.css'), /\.sim\b|\.ptab|\.formula|\.affix|\.result\b|simuladores/);
});
