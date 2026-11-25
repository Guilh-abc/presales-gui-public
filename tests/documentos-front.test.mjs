// 18/11/2026: front de "Documentos e links" (docs.js): funções puras, HTML (escape, perfil leitura), CSP e ligação no index.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const ler = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
function carregar() {
  const ctx = { Intl, Date, Math, Number, String, Array, Object, JSON, RegExp, Set, Map }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(ler('public/js/docs.js'), ctx, { filename: 'docs.js' });
  return ctx.KanzoDocs;
}
const D = carregar();
const J = (x) => JSON.parse(JSON.stringify(x));
const eq = (a, b) => assert.deepEqual(J(a), J(b));
const doc = (o) => Object.assign({ id: 1, card_id: 5, title: 'Proposta', doc_type: 'Proposta comercial', url: 'https://a.com/p', version: null, note: null, parent_id: null, responsible: 'Guilherme', created_at: '2026-11-18T10:00:00Z', updated_at: null, atual: false }, o);
const cadeia3 = [doc({ id: 1, version: 'v1' }), doc({ id: 2, version: 'v2', parent_id: 1, created_at: '2026-11-18T11:00:00Z' }), doc({ id: 3, version: 'v3', parent_id: 2, created_at: '2026-11-18T12:00:00Z', atual: true })];

test('puras: cadeia v1→v2→v3 a partir de qualquer item, passando por removido; filtro; separação Atual/antigas; próxima versão; host', () => {
  eq(D.cadeiaDe(cadeia3, 2).map(x => x.version), ['v1', 'v2', 'v3']);
  eq(D.cadeiaDe(cadeia3, 3).map(x => x.id), [1, 2, 3]);
  const comRemovido = [cadeia3[0], Object.assign({}, cadeia3[1], { removed_at: 'x' }), cadeia3[2]];
  eq(D.cadeiaDe(comRemovido, 1).map(x => x.id), [1, 2, 3]);
  eq(D.cadeiaDe(cadeia3, 99), []);
  const s = D.separar(cadeia3); eq(s.atuais.map(x => x.id), [3]); eq(s.antigas.map(x => x.id), [2, 1]);
  const l = [doc({ id: 1, title: 'Cotação Ingram', doc_type: 'Cotação', note: 'preço médio' }), doc({ id: 2, title: 'Ata kickoff', doc_type: 'Ata' })];
  eq(D.filtrar(l, 'Ata', '').map(x => x.id), [2]);
  eq(D.filtrar(l, '', 'COTACAO').map(x => x.id), [1]);
  eq(D.filtrar(l, '', 'preco').map(x => x.id), [1]);
  assert.equal(D.filtrar(l, 'Ata', 'cotação').length, 0);
  assert.equal(D.proximaVersao('v1'), 'v2'); assert.equal(D.proximaVersao('v9'), 'v10'); assert.equal(D.proximaVersao('zip10'), 'zip11'); assert.equal(D.proximaVersao('final'), ''); assert.equal(D.proximaVersao(null), '');
  assert.equal(D.hostDe('https://WWW.Drive.Google.com/file/d/1'), 'drive.google.com'); assert.equal(D.hostDe('x'), '');
});

test('validação do formulário (espelho do servidor): título, tipo, link, versão, observação', () => {
  const ok = { title: 'Proposta v1', doc_type: 'Ata', url: 'https://a.com/x', version: 'v1', note: 'ok' };
  assert.equal(D.validar(ok, true), null);
  assert.equal(D.validar(Object.assign({}, ok, { title: 'ab' }), true).campo, 'title');
  assert.equal(D.validar(Object.assign({}, ok, { title: 'x'.repeat(121) }), true).campo, 'title');
  assert.equal(D.validar(Object.assign({}, ok, { doc_type: '' }), true).campo, 'doc_type');
  assert.equal(D.validar(Object.assign({}, ok, { doc_type: '' }), false), null, 'na edição o tipo não muda');
  assert.equal(D.validar(Object.assign({}, ok, { url: '' }), true).campo, 'url');
  for (const u of ['javascript:alert(1)', 'ftp://a.com/x', 'a.com/x', 'https://a.com/a b']) assert.equal(D.validar(Object.assign({}, ok, { url: u }), true).campo, 'url', u);
  assert.equal(D.validar(Object.assign({}, ok, { version: 'v'.repeat(21) }), true).campo, 'version');
  assert.equal(D.validar(Object.assign({}, ok, { note: 'n'.repeat(301) }), true).campo, 'note');
  eq(D.TIPOS, ['Apresentação final', 'Proposta técnica', 'Proposta comercial', 'Cotação', 'Pricing', 'Contrato', 'Ata', 'Outro']);
});

test('bloco: admin vê ações, Atual, cadeia, histórico recolhido e removidos; leitura só vê e abre; texto vem escapado; link seguro', () => {
  const rem = [doc({ id: 9, title: 'Antigo', removed_at: '2026-11-18T13:00:00Z', removed_by: 'Guilherme', removal_reason: 'subi errado' })];
  const st = { aberto: true, data: { docs: cadeia3.concat([doc({ id: 4, doc_type: 'Ata', title: '<img src=x onerror=alert(1)>', url: 'https://b.com/a?x=1&y="2"', note: '<script>x</script>', atual: true })]), removidos: rem } };
  const adm = D.blocoHtml({ id: 5 }, { cw: true, adm: true, st });
  assert.match(adm, /<details class="dblk dc" id="d-docs" open>/); assert.match(adm, /Documentos e links <span class="dc-n-tot">\(4\)/);
  for (const a of ['novo', 'nova-versao', 'editar', 'historico', 'remover', 'copiar', 'abrir']) assert.match(adm, new RegExp('data-dc-acao="' + a + '"'), a);
  assert.match(adm, /<span class="tag ok">Atual<\/span>/); assert.equal((adm.match(/>Atual<\/span>/g) || []).length, 2, 'um Atual por tipo');
  assert.match(adm, /class="dc-chain"[\s\S]*v1[\s\S]*→[\s\S]*v2[\s\S]*v3/);
  assert.match(adm, /<details class="dc-sub dc-versoes">\s*<summary>Histórico de versões \(2\)/); // recolhido
  assert.match(adm, /Documentos removidos \(1\)/); assert.match(adm, /subi errado/);
  assert.doesNotMatch(adm, /<img src=x|<script>x/); assert.match(adm, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(adm, /target="_blank" rel="noopener noreferrer"/);
  assert.match(adm, /href="https:\/\/b\.com\/a\?x=1&amp;y=&quot;2&quot;"/);
  const leit = D.blocoHtml({ id: 5 }, { cw: false, adm: false, st });
  for (const a of ['novo', 'nova-versao', 'editar', 'historico', 'remover', 'cancelar-form']) assert.doesNotMatch(leit, new RegExp('data-dc-acao="' + a + '"'), 'leitura sem ' + a);
  assert.match(leit, /data-dc-acao="copiar"/); assert.match(leit, /data-dc-acao="abrir"/); assert.doesNotMatch(leit, /Documentos removidos/); assert.doesNotMatch(leit, /data-dc-form/);
});

test('formulário: campos, limites, "nova versão" pré-preenche título/tipo/pai, erro por campo, editar não deixa trocar o tipo', () => {
  const nv = D.formHtml({ modo: 'novo', v: { title: 'Proposta', doc_type: 'Proposta comercial', parent_id: '2', version: 'v3' }, docs: cadeia3 });
  assert.match(nv, /<b>Nova versão<\/b>/); assert.match(nv, /name="title"[^>]*value="Proposta"/); assert.match(nv, /<option value="Proposta comercial" selected>/);
  assert.match(nv, /<option value="2" selected>/); assert.match(nv, /name="version"[^>]*value="v3"/); assert.match(nv, /data-cnt="dcf-note">0\/300/); assert.match(nv, /data-cnt="dcf-title">8\/120/);
  assert.match(nv, /<kbd>Enter<\/kbd> salva · <kbd>Esc<\/kbd> cancela/); assert.match(nv, /type="url"/);
  const er = D.formHtml({ modo: 'novo', v: {}, erro: { campo: 'url', msg: 'Endereço interno não é permitido.' }, docs: [] });
  assert.match(er, /id="dcf-url-e" role="alert">Endereço interno não é permitido\./); assert.match(er, /name="url"[^>]*aria-invalid="true"/);
  const ed = D.formHtml({ modo: 'editar', id: 3, v: cadeia3[2], docs: cadeia3 });
  assert.match(ed, /id="dcf-type" value="Proposta comercial" disabled/); assert.match(ed, /não sobrescreve|ficam? no histórico|fica no histórico|histórico do item/); assert.doesNotMatch(ed, /name="parent_id"/);
});

test('sem style/handler inline (CSP); docs.js e docs.css ligados no index antes do app.js; app.js mostra ícone de contagem e carrega a seção', () => {
  const js = ler('public/js/docs.js'), css = ler('public/css/docs.css'), html = ler('public/index.html'), app = ler('public/js/app.js');
  assert.doesNotMatch(js, /style="|\son[a-z]+="|innerHTML\s*=\s*[^;]*\+\s*e\.message/);
  assert.match(html, /<link rel="stylesheet" href="css\/docs\.css" \/>/);
  assert.match(html, /<script src="js\/docs\.js"><\/script>\s*<script src="js\/tarefas\.js"><\/script>\s*<script src="js\/app\.js">/);
  assert.match(app, /docsCtl\.carregar\(c\.id\)/); assert.match(app, /\/api\/docs\/counts/); assert.match(app, /function tagDocs/); assert.match(app, /tagTarefas\(c, urgK\) \+ tagDocs\(c\)/);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /@media \(max-width:640px\)/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|[^&\w-])#[0-9a-fA-F]{3,8}\s*[;,)}]/, 'só tokens, sem cor solta');
});

