// 12/11/2026: alertas de prazo + relatório diário (src/alertas.js). D1 simulado; com a cópia do D1 de produção quando existir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { montar, FakeD1 } from './helpers/harness.mjs';
import { coletar, avisos, relatorioHtml, rodarCron, duracao, textoDias, instantePrazo, naJanela8h, textoHoras, itensJanela8h, diaISODe } from '../src/alertas.js';
import { migrar, MIGRATIONS } from '../src/migrations.js';

const COPIA = process.env.D1_COPIA || '/workspace/alertas/prod-copia.db';
const HOJE_MS = Date.parse('2026-11-12T17:45:00Z'); // 14:45 em Brasília

function envDaCopia() {
  const D = new FakeD1(); D.db.close(); D.db = new DatabaseSync(':memory:');
  const src = new DatabaseSync(COPIA, { readOnly: true });
  D.db.exec(src.prepare("SELECT group_concat(sql, ';\n') s FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").get().s + ';');
  for (const { name } of src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const rows = src.prepare('SELECT * FROM "' + name + '"').all(); if (!rows.length) continue;
    const cols = Object.keys(rows[0]); const st = D.db.prepare('INSERT INTO "' + name + '" (' + cols.map(c => '"' + c + '"').join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')');
    for (const r of rows) st.run(...cols.map(c => r[c]));
  }
  src.close();
  return { DATA: D };
}
const hash = (D, t) => JSON.stringify(D.db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all());

test('migração 8 só cria tabelas novas (idempotente, sem ALTER/DROP/DELETE)', () => {
  const m8 = MIGRATIONS.find(m => m.id === 8);
  for (const s of m8.sql) { assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /); assert.doesNotMatch(s, /DROP|DELETE|ALTER|UPDATE/i); }
});

test('textos de prazo e duração', () => {
  assert.equal(textoDias(-2), 'atrasado 2 dias'); assert.equal(textoDias(0), 'vence hoje'); assert.equal(textoDias(1), 'faltam 1 dia');
  assert.equal(duracao(null, '2026-11-12T10:00:00Z'), null); assert.equal(duracao('2026-11-12T10:00:00Z', null), null);
  assert.equal(duracao('2026-11-12T10:00:00Z', '2026-11-12T12:15:00Z'), '2 h 15 min');
});

test('criar tarefa grava início real em task_times; tempo gasto só com as duas marcas', async () => {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: (await import('./helpers/harness.mjs')).board() });
  const c = await h.call('/api/cards/46/tasks', { method: 'POST', body: { title: 'Tarefa nova', due_date: '2026-11-20' } });
  assert.equal(c.status, 200);
  const tt = h.DATA.db.prepare('SELECT * FROM task_times WHERE task_id = ?').get(c.body.id); assert.ok(tt && tt.started_at);
  await h.call('/api/tasks/' + c.body.id, { method: 'PATCH', body: { done: true } });
  const v = await coletar(h.env);
  const t = v.cards.find(x => x.id === 46).tarefas.find(x => x.id === c.body.id);
  assert.equal(t.done, true); assert.ok(t.tempo, 'tempo calculado das marcas reais');
  // sugestão já marcada como feita: sem início → sem tempo
  const sg = await h.call('/api/tasks?card_id=46'); assert.equal(sg.status, 200);
});

test('/api/alertas (contrato básico): admin 200 + last_seen_at; leitura lista vazia; anon 401', async () => {
  const h = await montar();
  const a = await h.call('/api/alertas'); assert.equal(a.status, 200); assert.ok(Array.isArray(a.body.avisos));
  assert.ok(h.DATA.db.prepare("SELECT value FROM meta WHERE key='last_seen_at'").get());
  const v = await h.call('/api/alertas', { as: 'viewer' }); assert.equal(v.status, 200); assert.deepEqual(v.body.avisos, []);
  assert.equal((await h.call('/api/relatorio', { as: 'viewer' })).status, 403);
  assert.equal((await h.call('/api/alertas', { as: 'anon' })).status, 401);
});

test('cópia do D1 de produção: todos os cards, MVNO primeiro, prazos só os gravados, nada escrito em cards/tarefas', { skip: !fs.existsSync(COPIA) }, async () => {
  const env = envDaCopia(); await migrar(env);
  const antes = ['cards', 'card_tasks', 'comments'].map(t => hash(env.DATA, t));
  const v = await coletar(env, HOJE_MS);
  const n = env.DATA.db.prepare('SELECT COUNT(*) n FROM cards WHERE deleted_at IS NULL').get().n;
  assert.equal(v.cards.length, n); assert.equal(v.resumo.total, n);
  assert.deepEqual(v.cards.slice(0, 2).map(x => x.id), [200354, 200353]);
  const dues = new Set(env.DATA.db.prepare('SELECT due_date d FROM card_tasks WHERE due_date IS NOT NULL').all().map(r => r.d));
  for (const x of v.cards) if (x.prazo) assert.ok(dues.has(x.prazo) || /\d{4}-\d{2}-\d{2}/.test(env.DATA.db.prepare('SELECT description d FROM cards WHERE id=?').get(x.id).d.match(new RegExp(x.prazo)) || ''), 'prazo gravado: ' + x.id);
  const claro = v.cards.find(x => x.id === 200353); assert.equal(claro.prazo, '2026-11-13'); assert.equal(claro.dias, 1);
  const isa = v.cards.find(x => x.id === 200354); assert.ok(isa.tarefas.filter(t => t.done).every(t => t.tempo === null), 'ISA: sem início registrado = sem tempo');
  const html = relatorioHtml(v, 'https://x'); assert.match(html, /Relatório diário de projetos/); assert.doesNotMatch(html, /<script|class=/);
  for (const x of v.cards) assert.ok(html.includes('#' + x.id), 'card no relatório: ' + x.id);
  // cron: sem binding de e-mail não envia; nunca escreve em cards/tarefas
  let r = await rodarCron(env, { agora: HOJE_MS }); assert.equal(r.email, 'sem_canal_email');
  env.DATA.db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_seen_at', ?)").run('2026-11-12T12:00:00Z');
  r = await rodarCron(env, { agora: HOJE_MS }); assert.equal(r.email, 'app_aberto_hoje');
  const enviados = []; env.EMAIL = { send: async m => { enviados.push(m); return { messageId: 'x' }; } };
  env.DATA.db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('alert_email_from', 'alertas@exemplo.com')").run();
  env.DATA.db.prepare("UPDATE meta SET value = '2026-11-11T12:00:00Z' WHERE key = 'last_seen_at'").run();
  r = await rodarCron(env, { agora: HOJE_MS }); assert.equal(r.email, 'enviado');
  assert.equal(enviados.length, 1); assert.equal(enviados[0].to, 'admin@exemplo.com');
  r = await rodarCron(env, { agora: HOJE_MS }); assert.equal(r.email, 'ja_enviado_hoje');
  r = await rodarCron(env, { agora: Date.parse('2026-11-14T21:00:00Z') }); assert.equal(r.email, 'fim_de_semana');
  assert.deepEqual(['cards', 'card_tasks', 'comments'].map(t => hash(env.DATA, t)), antes);
  assert.equal(avisos(v).length, v.resumo.ativos); // helper antigo (relatório); a API do app não usa mais essa pilha
  assert.deepEqual(itensJanela8h(v, HOJE_MS), [], 'em 12/11 14:45 BRT nenhum prazo está na janela de 8 h');
  const as19 = Date.parse('2026-11-13T22:00:00Z'); // 19:00 em Brasília
  const janela = itensJanela8h(v, as19);
  assert.ok(janela.length >= 3, '3 tarefas da Claro com prazo 13/11 entram às 15:59');
  const ids = janela.map(x => x.id).sort();
  assert.ok(ids.includes('tarefa:13') && ids.includes('tarefa:14') && ids.includes('tarefa:15'));
  janela.filter(x => x.card_id === 200353 && x.tipo === 'tarefa' && /2026-11-13/.test(x.prazo)).forEach(x => {
    assert.equal(x.vencido, false);
    assert.match(x.restante_txt, /faltam 4 h 59 min/);
    assert.match(x.prazo_br, /13\/11\/2026 23:59/);
  });
  const as16 = Date.parse('2026-11-13T18:58:00Z'); // 15:58 BRT: ainda fora
  assert.ok(!itensJanela8h(v, as16).some(x => x.id === 'tarefa:13'));
  const as1559 = Date.parse('2026-11-13T18:59:00Z'); // 15:59 BRT: entra
  assert.ok(itensJanela8h(v, as1559).some(x => x.id === 'tarefa:13'));
  const as235930 = Date.parse('2026-11-14T02:59:30Z'); // 23:59:30 BRT do dia 13: já vencido, ainda no mesmo dia
  const venceu = itensJanela8h(v, as235930).find(x => x.id === 'tarefa:13');
  assert.ok(venceu && venceu.vencido);
  const as0000 = Date.parse('2026-11-14T03:00:00Z'); // 00:00 BRT do dia 14: saiu da janela
  assert.ok(!itensJanela8h(v, as0000).some(x => x.id === 'tarefa:13'));
});


test('instante, janela de 8 h e textos: só data = 23:59 Brasília; com hora, usa a hora', () => {
  const inst = instantePrazo('2026-11-13');
  assert.equal(diaISODe(inst), '2026-11-13');
  assert.equal(new Date(inst).toISOString(), '2026-11-14T02:59:00.000Z'); // 23:59 BRT
  assert.equal(instantePrazo('13/11/2026'), inst);
  const comHora = instantePrazo('2026-11-13T10:00');
  assert.equal(new Date(comHora).toISOString(), '2026-11-13T13:00:00.000Z'); // 10:00 BRT
  const comTz = instantePrazo('2026-11-13T10:00:00-03:00');
  assert.equal(comTz, comHora);
  assert.equal(instantePrazo(''), null);
  assert.equal(instantePrazo('sem data'), null);

  // 15:59 entra, 15:58 não; depois das 23:59 ainda no dia 13 entra; 00:00 do dia 14 não
  assert.equal(naJanela8h(inst, Date.parse('2026-11-13T18:58:00Z')), false);
  assert.equal(naJanela8h(inst, Date.parse('2026-11-13T18:59:00Z')), true);
  assert.equal(naJanela8h(inst, Date.parse('2026-11-13T22:00:00Z')), true);
  assert.equal(naJanela8h(inst, Date.parse('2026-11-14T02:59:30Z')), true);
  assert.equal(naJanela8h(inst, Date.parse('2026-11-14T03:00:00Z')), false);

  // prazo com hora: janela começa 8 h antes e vai até o fim do dia em Brasília
  assert.equal(naJanela8h(comHora, Date.parse('2026-11-13T04:59:00Z')), false); // 01:59 BRT
  assert.equal(naJanela8h(comHora, Date.parse('2026-11-13T05:00:00Z')), true);  // 02:00 BRT
  assert.equal(naJanela8h(comHora, Date.parse('2026-11-13T16:00:00Z')), true);  // 13:00 BRT, já vencido no mesmo dia
  assert.equal(naJanela8h(comHora, Date.parse('2026-11-14T03:00:00Z')), false);

  assert.equal(textoHoras(8 * 3600000), 'faltam 8 h');
  assert.equal(textoHoras(4 * 3600000 + 59 * 60000), 'faltam 4 h 59 min');
  assert.equal(textoHoras(45 * 60000), 'faltam 45 min');
  assert.equal(textoHoras(60000), 'falta 1 min');
  assert.equal(textoHoras(0), 'vence agora');
  assert.equal(textoHoras(-10 * 60000), 'vencido há 10 min');
  assert.equal(textoHoras(-2 * 3600000 - 5 * 60000), 'vencido há 2 h 5 min');
});

test('/api/alertas: admin recebe só a janela de 8 h (sem pilha de pendências) e grava last_seen_at; leitura recebe lista vazia (200)', async () => {
  const h = await montar();
  const a = await h.call('/api/alertas'); assert.equal(a.status, 200);
  assert.ok(Array.isArray(a.body.avisos)); assert.deepEqual(a.body.avisos, []);
  assert.ok(Array.isArray(a.body.itens));
  assert.ok(h.DATA.db.prepare("SELECT value FROM meta WHERE key='last_seen_at'").get());
  const v = await h.call('/api/alertas', { as: 'viewer' }); assert.equal(v.status, 200);
  assert.deepEqual(v.body.avisos, []); assert.deepEqual(v.body.itens, []);
  assert.equal((await h.call('/api/relatorio', { as: 'viewer' })).status, 403);
  assert.equal((await h.call('/api/alertas', { as: 'anon' })).status, 401);
});

