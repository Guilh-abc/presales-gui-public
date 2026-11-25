// Item 1 do plano: um módulo só (public/js/kanzo-core.js) para Worker e painel.
// Prova que o comportamento NÃO mudou: compara com as implementações antigas (fixtures/legado-*.txt)
// nos 55 cards reais do snapshot, em várias datas, e que Worker e painel agora dão o mesmo resultado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function ctxCom(arquivos, extra = '') {
  const c = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, isFinite, parseFloat, parseInt };
  c.window = c; vm.createContext(c);
  for (const f of arquivos) vm.runInContext(f, c);
  if (extra) vm.runInContext(extra, c);
  return c;
}
// Antigo: funções do worker.js (linhas 217-304 da versão b57507ef) e o format.js antigo do painel.
const legW = rd('tests/fixtures/legado-worker.js.txt');
const trechoW = legW.slice(legW.indexOf('function parseTags(tags) {'), legW.indexOf('function cardDTO(r, comments) {'));
const OLDW = ctxCom([trechoW], 'this.W = { parseTags, stageFromTags, prioridadeFromTags, solutionFromTags, solutionFromDescription, valoresDaDescricao, isAtrasadoStatus };').W;
const OLDF = ctxCom([rd('tests/fixtures/legado-format.js.txt')]).KanzoFmt;
// Novo
const NOVO = ctxCom([rd('public/js/kanzo-core.js'), rd('public/js/format.js')]);
const K = NOVO.KanzoCore, F = NOVO.KanzoFmt;
const SNAP = ctxCom([rd('public/js/dados-kanzo.js')]).KANZO_SNAPSHOT;

const DIA = 86400000, BASE = Date.parse('2026-11-09T15:00:00Z');
const datas = [BASE, BASE - 30 * DIA, BASE + 30 * DIA, BASE + 120 * DIA, Date.parse('2026-11-10T02:30:00Z'), Date.parse('2026-11-10T03:30:00Z')];
// todas as viradas de dia em volta de cada prazo real
for (const c of SNAP.cards) { const p = K.prazos(c.description).prazo; if (p) { const t = Date.parse(p + 'T03:00:00Z'); datas.push(t - 1000, t, t + DIA - 1000, t + DIA); } }

test('kanzo-core carrega igual no Worker (globalThis) e no navegador (window)', async () => {
  await import('../public/js/kanzo-core.js');
  assert.equal(typeof globalThis.KanzoCore.isAtrasado, 'function');
  assert.deepEqual(Object.keys(globalThis.KanzoCore).sort(), Object.keys(K).sort());
});

test('atraso: novo == worker antigo == painel antigo nos 55 cards reais, em ' + datas.length + ' datas', () => {
  assert.equal(SNAP.cards.length, 55);
  let n = 0, atrasados = 0;
  for (const c of SNAP.cards) for (const st of [c.status, 'todo', 'doing', 'done']) for (const t of datas) {
    const novo = K.isAtrasado(st, c.description, t);
    assert.equal(novo, OLDW.isAtrasadoStatus(st, c.description, t), 'worker card ' + c.id + ' ' + st + ' ' + t);
    assert.equal(novo, OLDF.isAtrasado({ status: st, description: c.description }, t), 'painel antigo card ' + c.id);
    assert.equal(F.isAtrasado({ status: st, description: c.description }, t), novo, 'painel novo card ' + c.id);
    n++; if (novo) atrasados++;
  }
  assert.ok(n > 1000 && atrasados > 0);
});

test('atraso: done nunca atrasa, tag "atrasado" do Planner é ignorada, Kanzo vence Planner', () => {
  const d = '**Datas Planner:** Data de início: 2026-10-01 · Data de conclusão: 2026-10-20\n**Rótulos:** atrasado';
  assert.equal(K.isAtrasado('doing', d, BASE), true);
  assert.equal(K.isAtrasado('done', d, BASE), false);
  assert.equal(K.isAtrasado('doing', d + '\n**Prazo (Kanzo):** 2026-12-01', BASE), false, 'Prazo Kanzo futuro vence Planner vencido');
  assert.equal(K.isAtrasado('doing', '**Rótulos:** atrasado', BASE), false, 'só a tag não atrasa');
  assert.equal(K.isAtrasado('doing', '**Prazo (Kanzo):** 2026-11-09', BASE), false, 'vence hoje ainda não é atraso');
  assert.equal(K.isAtrasado('doing', '**Prazo (Kanzo):** 2026-11-08', BASE), true);
  // 23h30 de 09/11 em Brasília ainda é dia 09
  assert.equal(K.isAtrasado('doing', '**Prazo (Kanzo):** 2026-11-09', Date.parse('2026-11-10T02:30:00Z')), false);
  assert.equal(K.isAtrasado('doing', '**Prazo (Kanzo):** 2026-11-09', Date.parse('2026-11-10T03:30:00Z')), true);
  assert.equal(F.isAtrasado({ status: 'doing', description: '**Prazo (Kanzo):** 2026-11-08', deleted_at: '2026-11-09' }, BASE), false, 'removido não atrasa no painel');
});

test('valores TCV/MRC/OTC: novo == worker antigo (formato API) == painel antigo', () => {
  const extras = ['| TOTAL | R$ 10,00 | R$ 2,00 / mês |', '| **TCV (24 meses)** | `R$ 1.234.567,89` |', 'TCV estimado R$ 200k', '| MRC | R$ -5,00 |', '| OTC | sem valor |'];
  for (const d of SNAP.cards.map(c => c.description).concat(extras, extras.join('\n'))) {
    assert.deepEqual(JSON.parse(JSON.stringify(K.valoresApi(d))), JSON.parse(JSON.stringify(OLDW.valoresDaDescricao(d))));
    assert.deepEqual(JSON.parse(JSON.stringify(F.valoresDaDescricao(d))), JSON.parse(JSON.stringify(OLDF.valoresDaDescricao(d))));
  }
});

test('fatos do painel iguais aos antigos (prazo, fonte, responsáveis, saúde, próxima ação)', () => {
  for (const c of SNAP.cards) assert.deepEqual(JSON.parse(JSON.stringify(F.fatos(c.description))), JSON.parse(JSON.stringify(OLDF.fatos(c.description))), 'card ' + c.id);
});

test('tags e solução: novo == worker antigo', () => {
  const casos = ['stage:precificacao,prioridade:alta,solucao:Starlink', ' stage:hold , rotulo:x ', '', 'solucao:', ['stage:a', ' prioridade:b ']];
  for (const t of casos) {
    const a = K.parseTags(t), b = OLDW.parseTags(t);
    assert.deepEqual([...a], [...b]);
    assert.equal(K.stageFromTags(a), OLDW.stageFromTags(b));
    assert.equal(K.prioridadeFromTags(a), OLDW.prioridadeFromTags(b));
    assert.equal(K.solutionFromTags(a), OLDW.solutionFromTags(b));
  }
  for (const c of SNAP.cards) assert.equal(K.solutionFromDescription(c.description), OLDW.solutionFromDescription(c.description));
});

test('não sobrou cópia das regras no worker.js nem no format.js', () => {
  const w = rd('worker.js') + (fs.existsSync(new URL('../src', import.meta.url)) ? fs.readdirSync(new URL('../src', import.meta.url)).map(f => rd('src/' + f)).join('\n') : '');
  const f = rd('public/js/format.js');
  for (const src of [w, f]) {
    assert.doesNotMatch(src, /Data de conclus\[aã\]o/, 'regex do prazo Planner duplicada');
    assert.doesNotMatch(src, /R\\\$\\s\*-\?/, 'regex de valores duplicada');
  }
});
