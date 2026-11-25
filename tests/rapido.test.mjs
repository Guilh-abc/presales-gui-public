// Feature 6 — registro rápido: parser (frases reais × 55 cards reais do snapshot) e API (fila, permissões, desfazer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { montar, board, congelarRelogio, sha } from './helpers/harness.mjs';

const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, TextEncoder };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['public/js/dados-kanzo.js', 'public/js/kanzo-core.js', 'public/js/format.js', 'public/js/fields.js', 'public/js/rapido-parse.js'])
  vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
const R = ctx.KanzoRapido, FL = ctx.KanzoFields;
const CARDS = ctx.KANZO_SNAPSHOT.cards.map(c => ({ id: c.id, title: c.title, stage: c.stage, status: c.status }));
const SEG = Date.parse('2026-11-09T17:50:00Z'); // segunda 09/11/2026 14:50 em Brasília
const P = (t, o) => JSON.parse(JSON.stringify(R.interpretar(t, CARDS, Object.assign({ agora: SEG }, o || {}))));

test('vazio: não propõe nada', () => { const r = P('   '); assert.equal(r.ok, false); assert.equal(r.card_id, null); });

test('"Cliente Delta, mandei proposta": 3 cards Cliente Delta reais → ambíguo; escolhido → etapa Apresentação executiva', () => {
  const r = P('Cliente Delta, mandei proposta');
  assert.equal(r.ambiguous, true); assert.equal(r.ok, false);
  assert.deepEqual(r.candidatos.map(c => c.id).sort((a, b) => a - b), [42, 51, 53]);
  const c = P('Cliente Delta, mandei proposta', { card_id: 53 });
  assert.equal(c.ok, true); assert.equal(c.card_id, 53); assert.equal(c.mudancas.stage, 'apresentacao-executiva');
  assert.equal(c.comentario, 'Cliente Delta, mandei proposta'); assert.equal(c.fechamento, false);
});

test('"Cliente Beta aguardando assinatura, prazo sexta": saúde Aguardando externo + prazo 13/11/2026; "assinatura" não vira ganho', () => {
  const r = P('Cliente Beta aguardando assinatura, prazo sexta');
  assert.equal(r.card_id, 47); assert.equal(r.mudancas.stage, null);
  assert.equal(r.mudancas.saude, 'Aguardando externo'); assert.equal(r.mudancas.prazo, '2026-11-13');
  assert.ok(r.resumo.includes('Prazo (Kanzo): sexta, 13/11/2026'));
});

test('ganho/perda: exige confirmação extra; negação ou dúvida bloqueia', () => {
  assert.equal(P('Cliente Epsilon ganho').mudancas.stage, null, 'Cliente Epsilon já está em Ganho / Handoff');
  const g = P('Wurth, ganhamos'); assert.equal(g.mudancas.stage, 'ganho-handoff'); assert.equal(g.fechamento, true);
  const p = P('Sebrae, perdemos'); assert.equal(p.mudancas.stage, 'old-falhou'); assert.equal(p.fechamento, true);
  for (const t of ['Sebrae, perdemos?', 'Wurth, ainda não ganhamos', 'Wurth, se ganhar manda kit', 'Wurth não fechamos'])
    assert.equal(P(t).mudancas.stage, null, t);
});

test('sair de Ganho / Handoff também pede confirmação (reabre o card)', () => {
  const r = P('Já fiz proposta para o Cliente Beta');
  assert.equal(r.card_id, 47); assert.equal(r.mudancas.stage, 'apresentacao-executiva'); assert.equal(r.fechamento, true);
});

test('etapas explícitas mapeiam para as tags stage:* reais', () => {
  assert.equal(P('Masterboi em cotação').mudancas.stage, 'processo-de-cotacao');
  assert.equal(P('Cliente Alfa, em precificação').mudancas.stage, 'precificacao');
  assert.equal(P('Cliente Alfa, enviei para aprovação').mudancas.stage, 'processo-aprovacao-precificacao');
  assert.equal(P('Cliente Gama, vou revisar a proposta').mudancas.stage, null, '"proposta" solta não muda etapa');
  for (const v of Object.keys(R.STAGE_LABEL)) assert.ok(['hold','tarefas-internas-henrique','recebimento-do-projeto','processo-de-cotacao','precificacao','processo-aprovacao-precificacao','apresentacao-executiva','fechamento','ganho-handoff','projeto-longo-prazo','old-falhou'].includes(v));
});

test('saúde: atenção, risco, limpar', () => {
  assert.equal(P('Cliente Zeta atenção').mudancas.saude, 'Atenção');
  assert.equal(P('Cliente Zeta em risco').mudancas.saude, 'Em risco');
  assert.equal(P('Cliente Zeta limpar saúde').mudancas.saude, '');
});

test('"comentário:" = só comentário, mesmo com palavras de ação no texto', () => {
  const r = P('Cliente Eta comentário: cliente pediu revisão de MRC, mandei proposta');
  assert.equal(r.card_id, 56); assert.deepEqual(JSON.parse(JSON.stringify(r.mudancas)), { stage: null, saude: null, prazo: null });
  assert.equal(r.comentario, 'cliente pediu revisão de MRC, mandei proposta');
});

test('sem card reconhecível → pede para reformular', () => {
  const r = P('mandei proposta'); assert.equal(r.ok, false); assert.match(r.avisos[0], /Não encontrei nenhum card/);
});

test('só card, sem verbo → só comentário', () => {
  const r = P('Deutsche Bank, liguei para o cliente'); assert.equal(r.card_id, 46); assert.equal(r.mudancas.stage, null); assert.equal(r.comentario, 'Deutsche Bank, liguei para o cliente');
});

test('datas no fuso America/Sao_Paulo', () => {
  const dom2330 = Date.parse('2026-11-09T02:30:00Z'); // domingo 08/11 23:30 em Brasília (já segunda em UTC)
  assert.equal(R.resolverPrazo('amanhã', dom2330).iso, '2026-11-09');
  assert.equal(R.resolverPrazo('sexta', dom2330).iso, '2026-11-13');
  const sex = Date.parse('2026-11-13T15:00:00Z');
  assert.equal(R.resolverPrazo('sexta', sex).iso, '2026-11-20', '"sexta" dita numa sexta = a próxima');
  assert.equal(R.resolverPrazo('sexta que vem', SEG).iso, '2026-11-20');
  assert.equal(R.resolverPrazo('15/11', SEG).iso, '2026-11-15');
  const r = R.resolverPrazo('05/01', SEG); assert.equal(r.iso, '2027-01-05'); assert.ok(r.aviso);
  assert.equal(R.resolverPrazo('31/02', SEG).erro != null, true);
  assert.equal(R.resolverPrazo('dia 3', SEG).iso, '2026-12-03');
  assert.equal(R.resolverPrazo('logo logo', SEG).erro != null, true);
});

test('descrição nova usa o mesmo formato do editor (Saúde / Prazo (Kanzo)) sem perder o resto', () => {
  const c = ctx.KANZO_SNAPSHOT.cards.find(x => x.id === 47);
  const d = FL.set(FL.set(c.description, 'saude', 'Aguardando externo'), 'prazo', '2026-11-13');
  assert.equal(FL.get(d, 'saude'), 'Aguardando externo'); assert.equal(FL.get(d, 'prazo'), '2026-11-13');
  const novas = d.split('\n');
  for (const l of c.description.split('\n').filter(l => l.trim() && !/^\*\*(Sa[uú]de|Prazo \(Kanzo\)):\*\*/.test(l))) assert.ok(novas.includes(l), 'manteve: ' + l.slice(0, 40));
});

// ---------- API ----------
async function pronto() { const h = await montar(); await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() }); return h; }
const fila = (h) => h.DATA.db.prepare("SELECT id, op, status, payload_json FROM pending_commands ORDER BY id").all().map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));

test('API: viewer 403 em confirm/history/undo; sem X-MCO 403', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    assert.equal((await h.call('/api/rapido/confirm', { method: 'POST', as: 'viewer', body: { card_id: 46, raw: 'x', comentario: 'x' } })).status, 403);
    assert.equal((await h.call('/api/rapido/history', { as: 'viewer' })).status, 403);
    assert.equal((await h.call('/api/rapido/1/undo', { method: 'POST', as: 'viewer', body: {} })).status, 403);
    assert.equal((await h.call('/api/rapido/confirm', { method: 'POST', headers: { 'X-MCO': '' }, body: { card_id: 46, raw: 'x', comentario: 'x' } })).status, 403);
    assert.equal(fila(h).length, 0);
  } finally { volta(); }
});

test('API: confirm enfileira só update_task + add_comment, no formato que o agente do Mac aceita', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    const antes = (await h.call('/api/cards/47')).body;
    const desc = FL.set(antes.description, 'saude', 'Aguardando externo');
    const r = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 47, raw: 'Cliente Beta aguardando assinatura', comentario: 'Cliente Beta aguardando assinatura', description: desc, expect_description_sha256: sha(antes.description) } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.pending_command_ids.length, 2);
    const f = fila(h); assert.deepEqual(f.map(x => x.op), ['update_task', 'add_comment']);
    assert.equal(f[0].payload.id, antes.key); assert.equal(f[0].payload.base_description_sha256, sha(antes.description));
    assert.equal(f[0].payload.description, desc); assert.equal(f[0].payload.title, undefined, 'não mexe no título'); assert.equal(f[0].payload.tags, undefined, 'não mexe nas tags');
    assert.equal(f[1].payload.id, antes.key); assert.equal(f[1].payload.body, 'Cliente Beta aguardando assinatura');
    const pull = (await h.call('/sync/pull', { as: 'sync' })).body.commands; assert.equal(pull.length, 2);
    const hist = (await h.call('/api/rapido/history')).body.history; assert.equal(hist.length, 1); assert.equal(hist[0].status, 'pending'); assert.equal(hist[0].pode_desfazer, true);
  } finally { volta(); }
});

test('API: mudança de etapa preserva as outras tags; fechamento sem confirmação extra = 409 e nada na fila', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    const antes = (await h.call('/api/cards/44')).body;
    const n = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 44, raw: 'Wurth, ganhamos', comentario: 'Wurth, ganhamos', stage: 'ganho-handoff' } });
    assert.equal(n.status, 409); assert.equal(n.body.error, 'confirmar_fechamento'); assert.equal(fila(h).length, 0);
    assert.equal((await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 44, raw: 'x', comentario: 'x', stage: 'inventada' } })).status, 400);
    const ok = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 44, raw: 'Wurth, ganhamos', comentario: 'Wurth, ganhamos', stage: 'ganho-handoff', confirmar_fechamento: true } });
    assert.equal(ok.status, 200, ok.text);
    const tags = fila(h)[0].payload.tags.split(',');
    assert.ok(tags.includes('stage:ganho-handoff')); assert.equal(tags.filter(t => t.startsWith('stage:')).length, 1);
    for (const t of antes.tags.filter(t => !t.startsWith('stage:'))) assert.ok(tags.includes(t), 'manteve ' + t);
    assert.equal(fila(h)[0].payload.status, undefined, 'status do card não muda');
  } finally { volta(); }
});

test('API: hash desatualizado → 409 conflict e nada na fila', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    const r = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 47, raw: 'x', comentario: 'x', description: 'nova', expect_description_sha256: sha('outra coisa') } });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'conflict'); assert.equal(fila(h).length, 0);
  } finally { volta(); }
});

test('API: desfazer antes do Mac buscar → cancelled, some do pull e o espelho volta; depois do pull → 409', async () => {
  const volta = congelarRelogio(); let restaura = volta; try {
    const h = await pronto();
    const antes = (await h.call('/api/cards/46')).body;
    const c = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 46, raw: 'Deutsche Bank em cotação', comentario: 'Deutsche Bank em cotação', stage: 'processo-de-cotacao' } });
    assert.equal(c.status, 200, c.text);
    assert.equal((await h.call('/api/cards/46')).body.stage, 'processo-de-cotacao');
    const u = await h.call('/api/rapido/' + c.body.id + '/undo', { method: 'POST', body: {} });
    assert.equal(u.status, 200, u.text);
    assert.deepEqual(fila(h).map(x => x.status), ['cancelled', 'cancelled']);
    assert.equal((await h.call('/sync/pull', { as: 'sync' })).body.commands.length, 0, 'pull não entrega cancelados');
    const depois = (await h.call('/api/cards/46')).body;
    assert.equal(depois.stage, antes.stage); assert.equal(depois.comments.length, antes.comments.length);
    assert.equal((await h.call('/api/rapido/' + c.body.id + '/undo', { method: 'POST', body: {} })).status, 409);
    assert.equal((await h.call('/api/sync/status')).body.pending_commands, 0);
    // segundo registro; o Mac busca a fila (1 s depois) → não dá mais para desfazer
    const c2 = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 46, raw: 'Deutsche Bank nota: ok', comentario: 'ok' } });
    restaura(); restaura = congelarRelogio(Date.parse('2026-11-09T15:00:01Z'));
    await h.call('/sync/pull', { as: 'sync' });
    const u2 = await h.call('/api/rapido/' + c2.body.id + '/undo', { method: 'POST', body: {} });
    assert.equal(u2.status, 409); assert.equal(u2.body.error, 'mac_pode_ter_recebido');
    // Mac aplica → histórico mostra aplicado, sem desfazer
    const cmds = fila(h).filter(x => x.status === 'pending');
    await h.call('/sync/ack', { method: 'POST', as: 'sync', body: { ids: cmds.map(x => x.id), results: cmds.map(x => ({ ok: true, op: x.op })) } });
    const hist = (await h.call('/api/rapido/history')).body.history;
    assert.equal(hist[0].status, 'applied'); assert.equal(hist[0].pode_desfazer, false); assert.equal(hist[1].status, 'cancelled');
  } finally { restaura(); }
});

test('/rapido redireciona para /rapido.html; página sem inline', async () => {
  const h = await montar();
  const r = await h.call('/rapido', { headers: { Accept: 'text/html' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), '/rapido.html');
  const html = fs.readFileSync(new URL('../public/rapido.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style[\s>]|\sstyle\s*=|\son[a-z]+\s*=/i);
  assert.doesNotMatch(fs.readFileSync(new URL('../public/js/rapido.js', import.meta.url), 'utf8'), /innerHTML/);
});

test('Etapa B: confirm recusa descrição que muda algo além de Saúde/Prazo (título/escopo intocáveis) e não enfileira nada', async () => {
  const volta = congelarRelogio(); try {
    const h = await pronto();
    const antes = (await h.call('/api/cards/47')).body;
    const desc = FL.set(antes.description, 'saude', 'Atenção') + '\nlinha nova inventada';
    const r = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 47, raw: 'x', comentario: 'x', description: desc, expect_description_sha256: sha(antes.description) } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'descricao_fora_do_escopo'); assert.equal(fila(h).length, 0);
    const prazo = FL.set(antes.description, 'prazo', '2026-11-20');
    const r2 = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 47, raw: 'prazo dia 20', comentario: 'prazo dia 20', description: prazo, expect_description_sha256: sha(antes.description) } });
    assert.equal(r2.status, 200, r2.text);
    const f = fila(h); assert.equal(f[0].payload.status, undefined, 'nunca muda status'); assert.equal(f[0].payload.title, undefined);
  } finally { volta(); }
});

/* Mac simulado no formato do presales_sync_agent.py: update_task acha a tarefa pela chave (payload.id), recusa se o hash
   da descrição atual não bate com base_description_sha256 e só copia campos presentes; add_comment acrescenta comentário. */
function macAplica(b, cmds) {
  const tasks = b.projects[0].tasks, res = [];
  for (const c of cmds) {
    const p = c.payload, t = tasks.find(x => x.key === p.id);
    if (!t) { res.push({ ok: false, op: c.op, error: 'task not found' }); continue; }
    if (c.op === 'update_task') {
      if (p.base_description_sha256 && p.base_description_sha256 !== sha(t.description)) { res.push({ ok: false, op: c.op, error: 'conflict' }); continue; }
      for (const k of ['title', 'description', 'status', 'tags', 'url']) if (p[k] !== undefined && p[k] !== null) t[k] = p[k];
      t.updated_at = '2026-11-09T18:00:00Z'; res.push({ ok: true, op: c.op });
    } else if (c.op === 'add_comment') { t.comments.push({ id: 999000 + t.comments.length, author: p.author, body: p.body, created_at: '2026-11-09T18:00:00Z' }); res.push({ ok: true, op: c.op }); }
    else res.push({ ok: false, op: c.op, error: 'op não suportada' });
  }
  return res;
}
test('Etapa B ponta a ponta (Mac simulado): rápido → pull → Mac aplica → ack → push; título/status intactos, etapa e comentário aplicados', async () => {
  const volta = congelarRelogio(); try {
    const h = await montar(); const b = board();
    await h.call('/sync/push', { method: 'POST', as: 'sync', body: b });
    const antes = (await h.call('/api/cards/44')).body;
    const r = await h.call('/api/rapido/confirm', { method: 'POST', body: { card_id: 44, raw: 'Wurth em fechamento', comentario: 'Wurth em fechamento', stage: 'fechamento' } });
    assert.equal(r.status, 200, r.text);
    const cmds = (await h.call('/sync/pull', { as: 'sync' })).body.commands;
    assert.deepEqual(cmds.map(c => c.op), ['update_task', 'add_comment']);
    const res = macAplica(b, cmds.map(c => ({ op: c.op, payload: c.payload || JSON.parse(c.payload_json || '{}') })));
    assert.ok(res.every(x => x.ok), JSON.stringify(res));
    assert.equal((await h.call('/sync/ack', { method: 'POST', as: 'sync', body: { ids: cmds.map(c => c.id), results: res } })).status, 200);
    b.exported_at = '2026-11-09T18:01:00Z';
    assert.equal((await h.call('/sync/push', { method: 'POST', as: 'sync', body: b })).status, 200);
    const depois = (await h.call('/api/cards/44')).body;
    assert.equal(depois.title, antes.title); assert.equal(depois.status, antes.status); assert.equal(depois.description, antes.description);
    assert.equal(depois.stage, 'fechamento');
    for (const t of antes.tags.filter(t => !t.startsWith('stage:'))) assert.ok(depois.tags.includes(t), 'manteve ' + t);
    assert.ok(depois.comments.some(c => c.body === 'Wurth em fechamento'));
    const hist = (await h.call('/api/rapido/history')).body.history; assert.equal(hist[0].status, 'applied'); assert.equal(hist[0].pode_desfazer, false);
  } finally { volta(); }
});
