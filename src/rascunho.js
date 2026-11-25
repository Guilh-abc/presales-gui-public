/* presales-kanzo · src/rascunho.js — Item 4: do card para o pricing e o esqueleto de proposta (09/11/2026).
   SÓ ADMIN (a rota devolve 403 para leitura). Gera na hora a partir da descrição completa do card; NÃO grava nada no card.
   Regra: nada é inventado. Campo sem dado no card sai em branco ("____") para preencher. GM e gross-up só aparecem se o
   card tiver esses números escritos. A proposta (peça de cliente) nunca leva custo, GM, OR, gross-up, risco nem aliquota. */
'use strict';
import { K } from './format.js';
import { getCard } from './cards.js';
import { seguranca } from './http.js';
import { docsAtuais } from './documentos.js';

var BR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
var VAZIO = '____';
function brl(v) { return v == null || !isFinite(v) ? VAZIO : BR.format(v); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function hojeBR() { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date()); }
function dataBR(iso) { if (!iso) return null; var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : null; }

export var ALERTAS_STARLINK = [
  'Preços e planos Starlink podem mudar com 30 dias de aviso. Em contrato longo com preço travado, o risco da diferença é do revendedor.',
  'Conferir no Order a Terminal Access Charge mensal por terminal antes de fechar o preço.',
  'Dados extras (acima da franquia) são comprados pelo revendedor; definir como repassar ao cliente.'
];

function cliente(title) {
  var t = String(title || '').replace(/^\s*\d{4,}\s*[-–]\s*/, '');
  var p = t.split(/\s+[|–-]\s+|\s*\|\s*/)[0].trim();
  return p || null;
}
function secao(desc, re) {
  var linhas = String(desc || '').split('\n'), out = [], dentro = false, nivel = 0;
  for (var i = 0; i < linhas.length; i++) {
    var h = linhas[i].match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (dentro && h[1].length <= nivel) break; if (!dentro && re.test(h[2])) { dentro = true; nivel = h[1].length; continue; } }
    if (dentro) out.push(linhas[i]);
  }
  return out.join('\n').trim() || null;
}
function prazoMeses(desc, v) {
  if (v && v.prazo_meses) return { n: v.prazo_meses, fonte: 'linha de TCV da proposta' };
  var m = String(desc || '').match(/contrato[^0-9\n]{0,25}(\d{1,3})\s*meses/i); if (m) return { n: +m[1], fonte: '“' + m[0].trim() + '”' };
  m = String(desc || '').match(/\|\s*Total\s+(\d{1,3})\s*m\s*\|/i); if (m) return { n: +m[1], fonte: 'cabeçalho “Total ' + m[1] + 'm” da tabela' };
  return { n: null, fonte: null };
}
/* Itens da tabela de proposta com coluna Qtd (item, qtd, MRC unit). Só o que está escrito. */
function itens(desc) {
  var linhas = String(desc || '').split('\n'), out = [];
  for (var i = 0; i < linhas.length; i++) {
    if (!/^\s*\|/.test(linhas[i])) continue;
    var cab = linhas[i].split('|').map(function (x) { return x.trim().toLowerCase(); });
    var iq = cab.findIndex(function (x) { return /^(qtd|quantidade|qtde)\.?$/.test(x); });
    if (iq < 0) continue;
    var iu = cab.findIndex(function (x) { return /unit/.test(x); });
    for (var j = i + 2; j < linhas.length && /^\s*\|/.test(linhas[j]); j++) {
      var cel = linhas[j].split('|').map(function (x) { return x.trim(); });
      var nome = (cel[1] || '').replace(/\*\*/g, '');
      if (!nome || /^total/i.test(nome)) continue;
      var q = parseFloat(String(cel[iq] || '').replace(/\./g, '').replace(',', '.'));
      out.push({ item: nome, qtd: isFinite(q) ? q : null, unit: iu >= 0 ? K.numeroBR(cel[iu]) : null });
    }
    break;
  }
  return out;
}
function escopoLinha(d) { var m = String(d || '').match(/^\s*[-*]\s*\**Escopo\**\s*:\s*(.+)$/im); return m ? m[1].trim() : null; }
/* SLA só se o card tiver um único percentual de SLA; se houver valores diferentes, fica em branco com aviso. */
function sla(d) { var vs = {}; String(d || '').split('\n').forEach(function (l) { if (!/\bSLA\b/.test(l)) return; var re = /(\d{2}(?:[.,]\d+)?)\s*\**\s*%/g, m; while ((m = re.exec(l))) vs[m[1].replace('.', ',')] = 1; }); var k = Object.keys(vs); return { v: k.length === 1 ? k[0] : null, conflito: k.length > 1 ? k : null }; }
function quantidade(desc) { var m = String(desc || '').match(/^\s*(?:[-*]\s*)?\**(?:Quantidade|Qtd\.?|Qtde)\**\s*:\**\s*(\d+)/im); return m ? +m[1] : null; }
function percentual(desc, re) { var m = String(desc || '').match(re); return m ? { v: m[1].replace('.', ','), linha: m[0].trim() } : null; }

export function dadosRascunho(card) {
  var d = card.description || '', v = card.values || {}, pm = prazoMeses(d, v), p = K.prazos(d) || {};
  var starlink = /starlink/i.test((card.solution || '') + ' ' + card.title + ' ' + d);
  return {
    id: card.id, key: card.key, titulo: card.title, cliente: cliente(card.title), solucao: card.solution && !/^a definir$/i.test(card.solution) ? card.solution : null,
    etapa: card.stage_label || card.stage, mrc: v.mrc != null ? v.mrc : null, otc: v.otc != null ? v.otc : null, tcv: v.tcv != null ? v.tcv : null,
    linhas: { mrc: v.mrc_line || null, otc: v.otc_line || null, tcv: v.tcv_line || null },
    prazo_meses: pm.n, prazo_fonte: pm.fonte, prazo_card: dataBR(p.prazo), quantidade: quantidade(d), itens: itens(d),
    gm: percentual(d, /\bGM\b[^0-9%\n]{0,20}(\d{1,2}(?:[.,]\d+)?)\s*%/i), grossup: percentual(d, /gross[- ]?up[^0-9%\n]{0,25}(\d{1,2}(?:[.,]\d+)?)\s*%/i),
    escopo: secao(d, /escopo/i) || escopoLinha(d), starlink: starlink, otc_nenhum: v.otc == null && /\bOTC\b[^\n]{0,5}:\s*(nenhum|n[ãa]o h[áa]|isento|zero)/i.test(d), sla: sla(d)
  };
}

export function pricingMarkdown(x) {
  var L = [];
  L.push('# Rascunho de pricing — ' + x.titulo, '', '_Telekom · pré-vendas · uso interno · gerado em ' + hojeBR() + ' a partir do card ' + (x.key || x.id) + '. Não grava nada no card. Campo em branco = falta no card, preencher._', '');
  L.push('| Campo | Valor | Origem no card |', '|---|---|---|');
  L.push('| Cliente | ' + (x.cliente || VAZIO) + ' | título do card (conferir) |');
  L.push('| Solução | ' + (x.solucao || VAZIO) + ' | campo Solução |');
  L.push('| Etapa | ' + (x.etapa || VAZIO) + ' | tag stage |');
  L.push('| MRC (R$/mês) | ' + brl(x.mrc) + ' | ' + (x.linhas.mrc ? '`' + x.linhas.mrc.replace(/\|/g, '¦') + '`' : 'sem linha de MRC') + ' |');
  L.push('| OTC (R$) | ' + (x.otc == null && x.otc_nenhum ? 'sem OTC' : brl(x.otc)) + ' | ' + (x.linhas.otc ? '`' + x.linhas.otc.replace(/\|/g, '¦') + '`' : x.otc_nenhum ? 'card diz que não há OTC' : 'sem linha de OTC') + ' |');
  L.push('| TCV (R$) | ' + brl(x.tcv) + ' | ' + (x.linhas.tcv ? '`' + x.linhas.tcv.replace(/\|/g, '¦') + '`' : 'sem linha de TCV') + ' |');
  L.push('| Prazo do contrato (meses) | ' + (x.prazo_meses || VAZIO) + ' | ' + (x.prazo_fonte || 'não está no card') + ' |');
  L.push('| Quantidade | ' + (x.quantidade != null ? x.quantidade : (x.itens.length ? 'por item (abaixo)' : VAZIO)) + ' | ' + (x.quantidade != null ? 'linha Quantidade' : x.itens.length ? 'tabela da proposta' : 'não está no card') + ' |');
  if (x.gm) L.push('| GM | ' + x.gm.v + '% | `' + x.gm.linha.replace(/\|/g, '¦') + '` |');
  if (x.grossup) L.push('| Gross-up | ' + x.grossup.v + '% | `' + x.grossup.linha.replace(/\|/g, '¦') + '` |');
  L.push('| Prazo do card (entrega) | ' + (x.prazo_card || VAZIO) + ' | Prazo (Kanzo) ou conclusão do Planner |');
  if (x.itens.length) {
    L.push('', '## Itens da proposta (como estão no card)', '', '| Item | Qtd | MRC unit |', '|---|---:|---:|');
    x.itens.forEach(function (i) { L.push('| ' + i.item + ' | ' + (i.qtd != null ? i.qtd : VAZIO) + ' | ' + brl(i.unit) + ' |'); });
  }
  if (!x.gm || !x.grossup) L.push('', '> ' + (!x.gm && !x.grossup ? 'GM e gross-up não estão' : !x.gm ? 'GM não está' : 'Gross-up não está') + ' no card: calcular na matriz Pricing TC / DTGBS. Nada foi estimado aqui.');
  L.push('', '## A preencher na matriz', '', '- Custo unitário por item: ' + VAZIO, '- Código SAP do serviço: ' + VAZIO, '- Moeda e câmbio (se não for BRL): ' + VAZIO, '- Riscos técnico/comercial: ' + VAZIO);
  if (x.starlink) { L.push('', '## Alertas da revenda Starlink', ''); ALERTAS_STARLINK.forEach(function (a) { L.push('- ⚠ ' + a); }); }
  return L.join('\n') + '\n';
}

export function propostaMarkdown(x) {
  var L = [];
  L.push('# Proposta técnico-comercial — ' + (x.cliente || VAZIO), '', '**Deutsche Telekom** · rascunho gerado em ' + hojeBR() + ' a partir do card ' + (x.key || x.id) + ' · revisar antes de enviar', '');
  L.push('## 1. Cliente', '', x.cliente || VAZIO, '');
  L.push('## 2. Solução', '', x.solucao || VAZIO, '');
  L.push('## 3. Escopo', '', x.escopo ? K.descricaoLeitura(x.escopo) : VAZIO, '');
  L.push('## 4. Exclusões e premissas', '', '- ' + VAZIO, '');
  L.push('## 5. Prazo', '', '- Contrato: ' + (x.prazo_meses ? x.prazo_meses + ' meses' : VAZIO), '- Implantação / entrega: ' + (x.prazo_card || VAZIO), '');
  L.push('## 6. Valores', '', '| Item | Valor |', '|---|---:|', '| Mensalidade (MRC) | ' + brl(x.mrc) + ' |', '| Valor único (OTC) | ' + (x.otc == null && x.otc_nenhum ? 'não há' : brl(x.otc)) + ' |', '| Valor total do contrato (TCV) | ' + brl(x.tcv) + ' |', '');
  if (x.itens.length) { L.push('| Item | Qtd | Mensalidade unitária |', '|---|---:|---:|'); x.itens.forEach(function (i) { L.push('| ' + i.item + ' | ' + (i.qtd != null ? i.qtd : VAZIO) + ' | ' + brl(i.unit) + ' |'); }); L.push(''); }
  L.push('## 7. SLA, franquia e excedente', '', '- SLA: ' + (x.sla.v ? x.sla.v + '%' : VAZIO + (x.sla.conflito ? ' (o card tem valores diferentes: ' + x.sla.conflito.join('% e ') + '%; confirmar)' : '')), '- Franquia / excedente: ' + VAZIO, '');
  L.push('## 8. Validade e próximos passos', '', '- Validade da proposta: ' + VAZIO, '- Próximo passo: ' + VAZIO, '');
  if (x.starlink) { L.push('---', '', '**Checklist interno Starlink (remover antes de enviar ao cliente)**', ''); ALERTAS_STARLINK.forEach(function (a) { L.push('- [ ] ' + a); }); L.push(''); }
  return L.join('\n');
}

/* Markdown simples → HTML seguro (só #, ##, listas, tabelas, **negrito**, _itálico_, `código`, citação). */
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/(^|[\s(])_(.+?)_(?=[\s.,)]|$)/g, '$1<em>$2</em>'); }
export function mdParaHtml(md) {
  var L = md.split('\n'), o = [], i = 0, lista = false;
  function fecha() { if (lista) { o.push('</ul>'); lista = false; } }
  while (i < L.length) {
    var l = L[i];
    if (/^\|/.test(l) && /^\|[-:| ]+\|?$/.test(L[i + 1] || '')) {
      fecha(); var cab = l.split('|').slice(1, -1).map(function (c) { return c.trim(); });
      o.push('<table><thead><tr>' + cab.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>');
      i += 2; while (i < L.length && /^\|/.test(L[i])) { o.push('<tr>' + L[i].split('|').slice(1, -1).map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>'); i++; }
      o.push('</tbody></table>'); continue;
    }
    var h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) { fecha(); o.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); }
    else if (/^\s*- \[ \] /.test(l)) { if (!lista) { o.push('<ul class="check">'); lista = true; } o.push('<li>☐ ' + inline(l.replace(/^\s*- \[ \] /, '')) + '</li>'); }
    else if (/^\s*[-*] /.test(l)) { if (!lista) { o.push('<ul>'); lista = true; } o.push('<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>'); }
    else if (/^> /.test(l)) { fecha(); o.push('<blockquote>' + inline(l.slice(2)) + '</blockquote>'); }
    else if (/^---\s*$/.test(l)) { fecha(); o.push('<hr>'); }
    else if (l.trim()) { fecha(); o.push('<p>' + inline(l) + '</p>'); }
    else fecha();
    i++;
  }
  fecha(); return o.join('\n');
}
function pagina(titulo, corpo, mdHref) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(titulo) + '</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/rascunho.css"></head><body>' +
    '<nav class="barra"><button type="button" id="btn-imprimir">Imprimir / salvar PDF</button><a href="' + esc(mdHref) + '">Baixar .md</a><span>Rascunho gerado agora; nada foi gravado no card.</span></nav>' +
    '<main class="doc">' + corpo + '</main><script src="/js/rascunho-print.js"></script></body></html>';
}

/* GET /api/cards/:id/rascunho?tipo=pricing|proposta&formato=html|md  (admin; a rota já barrou leitura) */
export async function rascunhoCard(env, id, url) {
  var card = await getCard(env, id); // descrição completa (admin)
  if (!card || card.deleted_at) return new Response(JSON.stringify({ erro: 'Card não encontrado' }), { status: 404, headers: seguranca(new Headers({ 'Content-Type': 'application/json; charset=utf-8' })) });
  var tipo = url.searchParams.get('tipo') === 'proposta' ? 'proposta' : 'pricing', fmt = url.searchParams.get('formato') === 'md' ? 'md' : 'html';
  var x = dadosRascunho(card), md = tipo === 'proposta' ? propostaMarkdown(x) : pricingMarkdown(x);
  /* 18/11: "Documentos e links" (só os Atuais de cada tipo; nada aparece se o card não tem). Links como texto, sem buscar nada. */
  var atuais = await docsAtuais(env, id);
  if (atuais.length) md += '\n\n## Documentos e links (versões atuais)\n' + atuais.map(function (d) {
    return '- ' + d.doc_type + ': ' + d.title + (d.version ? ' (' + d.version + ')' : '') + ' — ' + d.url + (d.note ? ' — ' + d.note : '');
  }).join('\n') + '\n';
  var nome = (tipo === 'proposta' ? 'proposta-' : 'pricing-') + String(x.cliente || 'card-' + id).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + id;
  if (fmt === 'md') return new Response(md, { status: 200, headers: seguranca(new Headers({ 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + nome + '.md"' })) });
  var href = '/api/cards/' + id + '/rascunho?tipo=' + tipo + '&formato=md';
  return new Response(pagina((tipo === 'proposta' ? 'Proposta — ' : 'Pricing — ') + card.title, mdParaHtml(md), href), { status: 200, headers: seguranca(new Headers({ 'Content-Type': 'text/html; charset=utf-8' })) });
}
