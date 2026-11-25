// 18/11/2026: "Documentos e links" do card (migração 10: card_documents + card_document_history). Só links; nada em produção; D1 simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { montar, board } from './helpers/harness.mjs';
import { MIGRATIONS, SCHEMA_VERSION, migrar } from '../src/migrations.js';
import { validarUrl, normalizarUrl, validarCampos, limpaTexto, cadeia, marcarAtuais, TIPOS_DOC } from '../src/documentos.js';

async function pronto() {
  const h = await montar();
  await h.call('/sync/push', { method: 'POST', as: 'sync', body: board() });
  delete h.env.MAC_SYNC;
  const ids = (await h.call('/api/cards')).body.cards.map(c => c.id);
  return { h, A: ids[0], B: ids[1] };
}
const base = (o = {}) => ({ title: 'Proposta comercial Claro', doc_type: 'Proposta comercial', url: 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf', ...o });
const novo = (h, card, o) => h.call('/api/cards/' + card + '/docs', { method: 'POST', body: base(o) });
async function comAgente() {
  const ctx = await pronto();
  const k = await ctx.h.call('/api/admin/api-keys', { method: 'POST', body: { nome: 'OpenCode Mac' } });
  const ag = (path, o = {}) => ctx.h.call(path, { ...o, as: 'anon', headers: { Authorization: 'Bearer ' + k.body.chave, 'Content-Type': 'application/json', ...(o.headers || {}) } });
  return { ...ctx, ag };
}

test('migração 10: tabelas, índices (inclusive único parcial), triggers; up/down conferem; o app antigo (schema 9) sobe a 10', async () => {
  assert.equal(SCHEMA_VERSION, 10);
  const m = MIGRATIONS.find(x => x.id === 10);
  assert.ok(m && /card_documents/.test(m.sql[0]));
  assert.deepEqual(MIGRATIONS.map(x => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(i => MIGRATIONS.some(x => x.id === i)));
  const h = await montar({ semSchema: true });
  const nomes = (t) => h.DATA.db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(t).map(r => r.name);
  for (const t of ['card_documents', 'card_document_history']) assert.ok(nomes('table').includes(t), t);
  for (const i of ['ix_card_docs_card', 'ix_card_docs_card_tipo', 'ux_card_docs_url', 'ix_card_doc_hist_doc']) assert.ok(nomes('index').includes(i), i);
  for (const t of ['tg_card_doc_hist_no_update', 'tg_card_doc_hist_no_delete', 'tg_card_docs_no_delete']) assert.ok(nomes('trigger').includes(t), t);
  const ux = h.DATA.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ux_card_docs_url'").get().sql;
  assert.match(ux, /UNIQUE INDEX[\s\S]*\(card_id, url_norm\)[\s\S]*WHERE removed_at IS NULL/);
  // arquivo .up.sql = o que o app aplica; .down.sql desfaz tudo e volta a versão 9
  const up = fs.readFileSync(new URL('../schema/010-card-documents.up.sql', import.meta.url), 'utf8');
  for (const s of m.sql) assert.ok(up.includes(s + ';'), 'up.sql sem: ' + s.slice(0, 50));
  const down = fs.readFileSync(new URL('../schema/010-card-documents.down.sql', import.meta.url), 'utf8');
  h.DATA.exec(down);
  assert.ok(!nomes('table').includes('card_documents') && !nomes('table').includes('card_document_history'));
  assert.ok(!nomes('trigger').some(n => /card_doc/.test(n)));
  assert.equal(h.DATA.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '9');
  assert.deepEqual(await migrar(h.env), [10]); // sobe de novo, só adicionando
  assert.equal(h.DATA.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '10');
});

test('URL: só http/https; esquemas perigosos, credenciais e espaços saem', () => {
  for (const u of ['https://a.com/x', 'http://docs.exemplo.com.br/a?b=1#c', 'HTTPS://Drive.Google.com/file/d/1/view']) assert.equal(validarUrl(u).ok, true, u);
  const ruins = { 'javascript:alert(1)': 'esquema', 'data:text/html,<b>x</b>': 'esquema', 'file:///etc/passwd': 'esquema', 'ftp://a.com/x': 'esquema', 'mailto:a@b.com': 'esquema', 'vbscript:x': 'esquema',
    '//a.com/x': 'formato', 'a.com/x': 'formato', 'http:/a.com': 'formato', '': 'vazia', '   ': 'vazia', 'https://u:p@a.com/': 'credenciais', 'https://a.com/ x': 'formato', 'https://a.com/\nx': 'formato' };
  for (const [u, motivo] of Object.entries(ruins)) { const r = validarUrl(u); assert.equal(r.ok, false, u); assert.equal(r.motivo, motivo, u); assert.ok(r.msg); }
  assert.equal(validarUrl('https://a.com/' + 'x'.repeat(2001)).motivo, 'longa');
});

test('SSRF: localhost, redes privadas, link-local, metadata, IPv6 e formas disfarçadas de IP são bloqueados', () => {
  const bloqueados = ['http://localhost/x', 'http://LOCALHOST:8080/', 'http://app.localhost/', 'http://127.0.0.1/', 'http://127.1.2.3:3000/', 'http://0.0.0.0/', 'http://10.0.0.5/x',
    'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.10/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://255.255.255.255/',
    'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[fc00::1]:80/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[ff02::1]/',
    'http://metadata.google.internal/', 'http://servidor.local/', 'http://intranet/', 'http://wiki/', 'http://printer.lan/', 'https://x.localdomain/'];
  for (const u of bloqueados) { const r = validarUrl(u); assert.equal(r.ok, false, 'deveria bloquear ' + u); assert.match(r.motivo, /ip_privado|localhost|host_interno|host/, u); }
  for (const u of ['https://8.8.8.8/x', 'http://[2606:4700:4700::1111]/', 'https://docs.google.com/document/d/1', 'https://empresa.sharepoint.com/x']) assert.equal(validarUrl(u).ok, true, u);
});

test('normalização: mesma chave para variações triviais do mesmo link', () => {
  const n = (u) => validarUrl(u).norm;
  const k = n('https://Empresa.SharePoint.com/Sites/PV/a.pdf');
  for (const v of ['https://empresa.sharepoint.com/Sites/PV/a.pdf/', 'https://empresa.sharepoint.com:443/Sites/PV/a.pdf', 'https://empresa.sharepoint.com/Sites/PV/a.pdf#page=2', 'https://empresa.sharepoint.com/Sites/PV/a.pdf?utm_source=x&utm_medium=y', 'https://empresa.sharepoint.com./Sites/PV/a.pdf']) assert.equal(n(v), k, v);
  assert.equal(n('https://a.com/?b=2&a=1'), n('https://a.com/?a=1&b=2'));
  assert.notEqual(n('https://a.com/x'), n('http://a.com/x')); assert.notEqual(n('https://a.com/X'), n('https://a.com/x')); assert.notEqual(n('https://a.com/x?id=1'), n('https://a.com/x?id=2'));
});

test('campos: título 3–120, tipo da lista, versão ≤20, observação ≤300; texto sanitizado', () => {
  assert.deepEqual(TIPOS_DOC, ['Apresentação final', 'Proposta técnica', 'Proposta comercial', 'Cotação', 'Pricing', 'Contrato', 'Ata', 'Outro']);
  const ok = validarCampos(base({ version: 'zip10', note: 'ok' }), true); assert.ok(ok.campos);
  assert.equal(validarCampos(base({ title: 'ab' }), true).erro.motivo, 'titulo_curto');
  assert.equal(validarCampos(base({ title: '  a  ' }), true).erro.motivo, 'titulo_curto');
  assert.equal(validarCampos(base({ title: 'x'.repeat(121) }), true).erro.motivo, 'titulo_longo');
  assert.ok(validarCampos(base({ title: 'x'.repeat(120) }), true).campos);
  assert.equal(validarCampos(base({ doc_type: 'Planilha' }), true).erro.motivo, 'tipo');
  assert.equal(validarCampos(base({ doc_type: undefined }), true).erro.campo, 'doc_type');
  assert.equal(validarCampos(base({ version: 'v'.repeat(21) }), true).erro.motivo, 'versao_longa');
  assert.equal(validarCampos(base({ version: 'v1<script>' }), true).erro.motivo, 'versao_formato');
  assert.equal(validarCampos(base({ note: 'n'.repeat(301) }), true).erro.motivo, 'nota_longa');
  assert.ok(validarCampos(base({ note: 'n'.repeat(300) }), true).campos);
  assert.equal(limpaTexto('  a\u0000b\u202Ec\u200Bd \n\t e  '), 'a b c d e');
  assert.equal(validarCampos(base({ title: 'Prop\u202Eosta\u0007 final' }), true).campos.title, 'Prop osta final');
});

test('admin cria; responsável e data vêm do servidor (corpo é ignorado); erro de validação é registrado em log sem o link', async () => {
  const { h, A } = await pronto();
  const logs = []; const orig = console.warn; console.warn = (m) => logs.push(m);
  const antesFetch = globalThis.fetch; let buscou = 0; globalThis.fetch = (...a) => { buscou++; return antesFetch(...a); };
  try {
    const r = await novo(h, A, { title: '  Proposta   v1 ', version: 'v1', note: ' fechada com o cliente ', responsible: 'Fulano', created_at: '2001-01-01T00:00:00Z', created_by: 'x' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.title, 'Proposta v1'); assert.equal(r.body.note, 'fechada com o cliente'); assert.equal(r.body.version, 'v1');
    assert.notEqual(r.body.responsible, 'Fulano'); assert.ok(r.body.responsible); assert.ok(r.body.created_at > '2026-01-01'); assert.equal(r.body.atual, true);
    assert.equal(r.body.url, 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf');
    const ruim = await novo(h, A, { url: 'http://169.254.169.254/latest', title: 'Segredo https://x' });
    assert.equal(ruim.status, 400); assert.equal(ruim.body.error, 'ip_privado'); assert.equal(ruim.body.campo, 'url');
    assert.ok(logs.length >= 1); const l = JSON.parse(logs[logs.length - 1]);
    assert.equal(l.evento, 'docs_validacao'); assert.equal(l.campo, 'url'); assert.equal(l.motivo, 'ip_privado'); assert.equal(l.card_id, A);
    assert.ok(!logs.join('').includes('169.254.169.254'), 'o log não guarda o link');
    assert.equal(buscou, 0, 'o servidor nunca busca a URL');
  } finally { console.warn = orig; globalThis.fetch = antesFetch; }
  assert.equal((await novo(h, 999999)).status, 404);
  assert.equal((await h.call('/api/cards/' + A + '/docs', { method: 'POST', body: 'x' })).status >= 400, true);
});

test('duplicata: mesma URL normalizada no mesmo card = 409; outro card ok; depois de remover pode voltar; editar para duplicata também barra; o índice garante', async () => {
  const { h, A, B } = await pronto();
  const a = await novo(h, A); assert.equal(a.status, 200);
  const d = await novo(h, A, { title: 'Outro nome', doc_type: 'Cotação', url: 'https://EMPRESA.sharepoint.com/sites/pv/proposta-v1.pdf/?utm_campaign=z#x' });
  assert.equal(d.status, 409); assert.equal(d.body.error, 'duplicado'); assert.match(d.body.erro, /Proposta comercial Claro/);
  assert.equal((await novo(h, B)).status, 200);
  const b = await novo(h, A, { title: 'Cotação Ingram', doc_type: 'Cotação', url: 'https://x.com/cot.pdf' }); assert.equal(b.status, 200);
  const e = await h.call('/api/docs/' + b.body.id, { method: 'PATCH', body: { url: 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf' } });
  assert.equal(e.status, 409); assert.equal(e.body.error, 'duplicado');
  assert.equal((await h.call('/api/docs/' + a.body.id + '/remove', { method: 'POST', body: { reason: 'arquivo errado' } })).status, 200);
  assert.equal((await novo(h, A)).status, 200); // link liberado depois da remoção
  assert.throws(() => h.DATA.db.prepare("INSERT INTO card_documents (card_id, title, doc_type, url, url_norm, responsible, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(A, 'x', 'Ata', 'https://a.com', 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf', 'x', 'x', '2026'), /UNIQUE/);
});

test('versões: "nova versão de" só do mesmo card e tipo; cadeia v1→v2→v3; só o mais novo do tipo é Atual; remover o Atual passa o selo adiante', async () => {
  const { h, A, B } = await pronto();
  const v1 = await novo(h, A, { version: 'v1', url: 'https://x.com/p1' });
  const ata = await novo(h, A, { title: 'Ata kickoff', doc_type: 'Ata', url: 'https://x.com/ata' });
  const v2 = await novo(h, A, { version: 'v2', url: 'https://x.com/p2', parent_id: v1.body.id });
  const v3 = await novo(h, A, { version: 'v3', url: 'https://x.com/p3', parent_id: v2.body.id });
  assert.equal(v3.status, 200); assert.equal(v3.body.parent_id, v2.body.id);
  // erros de pai
  const outroTipo = await novo(h, A, { title: 'Cotação x', doc_type: 'Cotação', url: 'https://x.com/c', parent_id: v1.body.id });
  assert.equal(outroTipo.status, 400); assert.equal(outroTipo.body.error, 'pai_tipo');
  const outroCard = await novo(h, B, { version: 'v9', url: 'https://x.com/b9', parent_id: v1.body.id }); assert.equal(outroCard.body.error, 'pai_invalido');
  assert.equal((await novo(h, A, { url: 'https://x.com/z', parent_id: 99999 })).body.error, 'pai_invalido');
  assert.equal((await novo(h, A, { url: 'https://x.com/z', parent_id: 'abc' })).body.error, 'pai_invalido');
  // lista: Atual por tipo
  let l = (await h.call('/api/cards/' + A + '/docs')).body;
  const atual = (id) => l.docs.find(d => d.id === id).atual;
  assert.equal(atual(v3.body.id), true); assert.equal(atual(v2.body.id), false); assert.equal(atual(v1.body.id), false); assert.equal(atual(ata.body.id), true);
  assert.equal(l.docs.filter(d => d.atual).length, 2);
  assert.deepEqual(l.docs.map(d => d.id), [...l.docs].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)).map(d => d.id), 'mais novos primeiro');
  assert.deepEqual(l.tipos, TIPOS_DOC);
  // cadeia (função pura e API de histórico)
  const linhas = h.DATA.db.prepare('SELECT * FROM card_documents WHERE card_id = ?').all(A);
  assert.deepEqual(cadeia(linhas, v2.body.id).map(x => x.version), ['v1', 'v2', 'v3']);
  assert.deepEqual(cadeia(linhas, ata.body.id).map(x => x.title), ['Ata kickoff']);
  const hs = (await h.call('/api/docs/' + v1.body.id + '/history')).body; assert.deepEqual(hs.versoes.map(x => x.version), ['v1', 'v2', 'v3']);
  // remover o Atual: o anterior vira Atual; a cadeia atravessa o item removido
  assert.equal((await h.call('/api/docs/' + v3.body.id + '/remove', { method: 'POST', body: { reason: 'versão errada' } })).status, 200);
  l = (await h.call('/api/cards/' + A + '/docs')).body;
  assert.equal(l.docs.find(d => d.id === v2.body.id).atual, true); assert.equal(l.docs.some(d => d.id === v3.body.id), false);
  assert.equal((await novo(h, A, { url: 'https://x.com/z', version: 'v4', parent_id: v3.body.id })).body.error, 'pai_invalido'); // pai removido
  // marcarAtuais: desempate por id quando a data é igual
  const m = marcarAtuais([{ id: 1, doc_type: 'Ata', created_at: 'x' }, { id: 2, doc_type: 'Ata', created_at: 'x' }, { id: 3, doc_type: 'Ata', created_at: 'y', removed_at: 'z' }]);
  assert.equal(m.Ata.id, 2);
});

test('edição nunca sobrescreve em silêncio: cada edição entra no histórico (antes/depois, quem, quando); sem mudança = recusa; tipo e pai não mudam', async () => {
  const { h, A } = await pronto();
  const d = await novo(h, A, { version: 'v1', note: 'primeira' }); const id = d.body.id;
  let r = await h.call('/api/docs/' + id, { method: 'PATCH', body: { title: 'Proposta comercial Claro (revisada)', url: 'https://x.com/nova', version: 'v1.1', note: 'trocamos o arquivo' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.title, 'Proposta comercial Claro (revisada)'); assert.equal(r.body.version, 'v1.1');
  r = await h.call('/api/docs/' + id, { method: 'PATCH', body: { note: '' } }); assert.equal(r.status, 200); assert.equal(r.body.note, null);
  const hs = (await h.call('/api/docs/' + id + '/history')).body.historico;
  assert.deepEqual(hs.map(x => x.action), ['edit', 'edit', 'create']); // mais recente primeiro
  const e1 = hs[1];
  assert.equal(e1.changes.url.de, 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf'); assert.equal(e1.changes.url.para, 'https://x.com/nova');
  assert.equal(e1.changes.title.de, 'Proposta comercial Claro'); assert.equal(e1.changes.version.de, 'v1'); assert.equal(e1.changes.note.de, 'primeira');
  assert.equal(e1.before.url, 'https://empresa.sharepoint.com/sites/pv/proposta-v1.pdf'); assert.equal(e1.after.version, 'v1.1');
  assert.ok(e1.by && e1.at); assert.equal(hs[0].changes.note.de, 'trocamos o arquivo'); assert.equal(hs[0].changes.note.para, null);
  assert.equal(hs[2].before, null); assert.equal(hs[2].after.title, 'Proposta comercial Claro');
  // sem mudança, tipo/pai imutáveis, validação também na edição
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { title: 'Proposta comercial Claro (revisada)' } })).body.error, 'sem_mudanca');
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { doc_type: 'Ata' } })).body.error, 'tipo_imutavel');
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { parent_id: 5 } })).body.error, 'pai_imutavel');
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { url: 'ftp://x.com/a' } })).body.error, 'esquema');
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { title: 'ab' } })).body.error, 'titulo_curto');
  assert.equal((await h.call('/api/docs/99999', { method: 'PATCH', body: { title: 'abc' } })).status, 404);
  assert.equal((await h.call('/api/docs/' + id + '/history')).body.historico.length, 3, 'recusas não entram no histórico');
  // auditoria geral do app também registra
  const au = h.DATA.db.prepare("SELECT action FROM audit_log WHERE entity = 'document' ORDER BY id").all().map(x => x.action);
  assert.deepEqual(au, ['doc_create', 'doc_update', 'doc_update']);
});

test('histórico é append-only e documento nunca é apagado de verdade (triggers no banco)', async () => {
  const { h, A } = await pronto();
  const d = await novo(h, A); await h.call('/api/docs/' + d.body.id, { method: 'PATCH', body: { note: 'x' } });
  assert.throws(() => h.DATA.db.exec("UPDATE card_document_history SET by_user = 'fraude'"), /somente de inclusao/);
  assert.throws(() => h.DATA.db.exec('DELETE FROM card_document_history'), /somente de inclusao/);
  assert.throws(() => h.DATA.db.exec('DELETE FROM card_documents'), /remocao so logica/);
  assert.equal(h.DATA.db.prepare('SELECT COUNT(*) AS n FROM card_document_history').get().n, 2);
});

test('remoção lógica: motivo obrigatório (≤200), vai para "removidos" (só admin), contador cai, linha e histórico ficam', async () => {
  const { h, A } = await pronto();
  const d = await novo(h, A); const id = d.body.id;
  assert.equal((await h.call('/api/docs/' + id + '/remove', { method: 'POST', body: {} })).body.error, 'motivo');
  assert.equal((await h.call('/api/docs/' + id + '/remove', { method: 'POST', body: { reason: '   ' } })).body.error, 'motivo');
  assert.equal((await h.call('/api/docs/' + id + '/remove', { method: 'POST', body: { reason: 'x'.repeat(201) } })).body.error, 'motivo_longo');
  assert.equal((await h.call('/api/docs/counts')).body.counts[A], 1);
  const r = await h.call('/api/docs/' + id + '/remove', { method: 'POST', body: { reason: 'Subiu o arquivo errado' } });
  assert.equal(r.status, 200); assert.equal(r.body.removal_reason, 'Subiu o arquivo errado'); assert.ok(r.body.removed_at && r.body.removed_by);
  const adm = (await h.call('/api/cards/' + A + '/docs')).body;
  assert.equal(adm.docs.length, 0); assert.equal(adm.removidos.length, 1); assert.equal(adm.removidos[0].removal_reason, 'Subiu o arquivo errado'); assert.ok(adm.removidos[0].removed_by);
  const vw = (await h.call('/api/cards/' + A + '/docs', { as: 'viewer' })).body; assert.equal(vw.docs.length, 0); assert.equal(vw.removidos, undefined);
  assert.equal((await h.call('/api/docs/counts')).body.counts[A], undefined);
  assert.equal(h.DATA.db.prepare('SELECT COUNT(*) AS n FROM card_documents WHERE id = ? AND removed_at IS NOT NULL').get(id).n, 1);
  const hs = (await h.call('/api/docs/' + id + '/history')).body.historico; assert.deepEqual(hs.map(x => x.action), ['remove', 'create']); assert.equal(hs[0].reason, 'Subiu o arquivo errado');
  assert.equal((await h.call('/api/docs/' + id + '/remove', { method: 'POST', body: { reason: 'de novo' } })).status, 409);
  assert.equal((await h.call('/api/docs/' + id, { method: 'PATCH', body: { note: 'x' } })).status, 404);
});

test('permissões: viewer só lê (sem removidos nem histórico; texto sem custo/margem); anônimo 401; escrita exige a origem do app', async () => {
  const { h, A } = await pronto();
  const d = await novo(h, A, { title: 'Pricing: custo R$ 1.234,00 e margem', note: 'margem 20% R$ 99.000' });
  const vw = await h.call('/api/cards/' + A + '/docs', { as: 'viewer' });
  assert.equal(vw.status, 200); assert.equal(vw.body.docs.length, 1);
  assert.doesNotMatch(JSON.stringify(vw.body), /1\.234|99\.000/); assert.match(vw.body.docs[0].title, /omitido/);
  assert.match((await h.call('/api/cards/' + A + '/docs')).body.docs[0].title, /1\.234/); // admin vê completo
  assert.equal((await h.call('/api/cards/' + A + '/docs', { method: 'POST', as: 'viewer', body: base({ url: 'https://v.com/a' }) })).status, 403);
  assert.equal((await h.call('/api/docs/' + d.body.id, { method: 'PATCH', as: 'viewer', body: { note: 'x' } })).status, 403);
  assert.equal((await h.call('/api/docs/' + d.body.id + '/remove', { method: 'POST', as: 'viewer', body: { reason: 'x' } })).status, 403);
  assert.equal((await h.call('/api/docs/' + d.body.id + '/history', { as: 'viewer' })).status, 403);
  assert.equal((await h.call('/api/docs/counts', { as: 'viewer' })).status, 200);
  assert.equal((await h.call('/api/cards/' + A + '/docs', { as: 'anon' })).status, 401);
  assert.equal((await h.call('/api/cards/' + A + '/docs', { method: 'POST', as: 'anon', body: base() })).status, 401);
  assert.equal((await h.call('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'https://o.com/a' }), headers: { Origin: 'https://mal.test' } })).status, 403);
  assert.equal((await h.call('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'https://o.com/b' }), headers: { 'X-MCO': '' } })).status, 403);
  assert.equal((await h.call('/api/docs/' + d.body.id, { method: 'DELETE' })).status, 405); // não existe exclusão física
  assert.equal((await h.call('/api/docs/counts')).body.counts[A], 1);
});

test('chave do OpenCode: lista e cria (mesmas regras); não edita, não remove, não vê histórico/removidos; sem custo/margem; responsável "via OpenCode"', async () => {
  const { h, A, ag } = await comAgente();
  const r = await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ version: 'v1', url: 'https://x.com/ag1' }) });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.responsible, 'via OpenCode'); assert.equal(r.body.atual, true);
  assert.equal((await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'https://x.com/ag1/' }) })).body.error, 'duplicado');
  assert.equal((await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'http://127.0.0.1/x' }) })).body.error, 'ip_privado');
  assert.equal((await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'https://x.com/ag2', responsible: 'Eu' }) })).body.error, 'campo_nao_permitido');
  assert.equal((await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ url: 'https://x.com/ag3', title: 'Pricing: custo R$ 1.234,00 e margem' }) })).body.error, 'custo_margem');
  const v2 = await ag('/api/cards/' + A + '/docs', { method: 'POST', body: base({ version: 'v2', url: 'https://x.com/ag4', parent_id: r.body.id }) });
  assert.equal(v2.status, 200); assert.equal(v2.body.parent_id, r.body.id);
  const l = await ag('/api/cards/' + A + '/docs'); assert.equal(l.status, 200); assert.equal(l.body.docs.length, 2); assert.equal(l.body.removidos, undefined);
  assert.equal((await ag('/api/docs/' + r.body.id, { method: 'PATCH', body: { note: 'x' } })).body.error, 'fora_do_escopo');
  assert.equal((await ag('/api/docs/' + r.body.id + '/remove', { method: 'POST', body: { reason: 'x' } })).body.error, 'fora_do_escopo');
  assert.equal((await ag('/api/docs/' + r.body.id + '/history')).body.error, 'fora_do_escopo');
  assert.equal((await ag('/api/docs/' + r.body.id, { method: 'DELETE' })).body.error, 'delete_nao_permitido');
  assert.equal(h.DATA.db.prepare("SELECT COUNT(*) AS n FROM card_document_history WHERE by_user = 'via OpenCode'").get().n, 2);
  assert.equal((await h.call('/api/admin/api-keys')).status, 200);
});

test('exportação do card (rascunho): inclui só os documentos Atuais; sem documentos, o texto é o de sempre', async () => {
  const { h, A } = await pronto();
  const antes = (await h.call('/api/cards/' + A + '/rascunho?tipo=proposta&formato=md')).text;
  assert.doesNotMatch(antes, /Documentos e links/);
  const v1 = await novo(h, A, { version: 'v1', url: 'https://x.com/p1' });
  await novo(h, A, { version: 'v2', url: 'https://x.com/p2', parent_id: v1.body.id, note: 'com o desconto aprovado' });
  await novo(h, A, { title: 'Ata de kickoff', doc_type: 'Ata', url: 'https://x.com/ata' });
  const md = (await h.call('/api/cards/' + A + '/rascunho?tipo=proposta&formato=md')).text;
  assert.match(md, /## Documentos e links \(versões atuais\)/); assert.match(md, /Proposta comercial: Proposta comercial Claro \(v2\) — https:\/\/x\.com\/p2 — com o desconto aprovado/);
  assert.match(md, /Ata: Ata de kickoff — https:\/\/x\.com\/ata/); assert.doesNotMatch(md, /x\.com\/p1/);
  assert.equal((await h.call('/api/cards/' + A + '/rascunho?tipo=pricing&formato=md')).text.includes('x.com/p2'), true);
  assert.equal((await h.call('/api/cards/' + A + '/rascunho?tipo=proposta&formato=md', { as: 'viewer' })).status, 403);
});

test('saúde anuncia docs; contador por card só conta ativos de cards ativos', async () => {
  const { h, A, B } = await pronto();
  assert.ok((await h.call('/api/saude', { as: 'anon' })).body.features.includes('docs'));
  await novo(h, A); await novo(h, A, { url: 'https://x.com/2' }); const b = await novo(h, B, { url: 'https://x.com/3' });
  let c = (await h.call('/api/docs/counts')).body.counts; assert.equal(c[A], 2); assert.equal(c[B], 1);
  await h.call('/api/docs/' + b.body.id + '/remove', { method: 'POST', body: { reason: 'teste' } });
  c = (await h.call('/api/docs/counts')).body.counts; assert.equal(c[B], undefined);
});
