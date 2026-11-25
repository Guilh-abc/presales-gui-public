/* presales-kanzo · src/format.js — Regras de leitura do card: vêm do módulo único public/js/kanzo-core.js (o mesmo do painel). */
'use strict';
import '../public/js/kanzo-core.js';
import { agora } from './util.js';

export var K = globalThis.KanzoCore;

/* Regras de leitura do card: módulo ÚNICO compartilhado com o painel (public/js/kanzo-core.js). */
export var parseTags = K.parseTags, stageFromTags = K.stageFromTags, prioridadeFromTags = K.prioridadeFromTags,
  solutionFromTags = K.solutionFromTags, solutionFromDescription = K.solutionFromDescription,
  limpaMd = K.limpa, valoresDaDescricao = K.valoresApi;

/* Atraso = prazo efetivo (Kanzo > Planner) < hoje America/Sao_Paulo e status != done. Tag "atrasado" ignorada. */
export function isAtrasadoStatus(status, desc, agora) { return K.isAtrasado(status, desc, agora); }

/* v3: diferença legível entre duas versões do card, para o histórico (quem mudou o quê e quando). */
export function camposRotulados(desc) {
  var out = {};
  String(desc || '').split('\n').forEach(function (l) {
    var m = l.match(/^\s*\*\*([^*\n]{2,60}?):\*\*\s*(.*)$/); if (m && m[2].trim()) out[m[1].trim()] = limpaMd(m[2]);
  });
  var v = valoresDaDescricao(desc); ['tcv', 'mrc', 'otc'].forEach(function (k) { if (v[k] != null) out[k.toUpperCase()] = 'R$ ' + v[k]; });
  return out;
}

export function diffCard(a, b) {
  a = a || {}; b = b || {};
  var out = [], ca = camposRotulados(a.description), cb = camposRotulados(b.description);
  [['title', 'Título'], ['status', 'Status'], ['stage', 'Etapa'], ['solution', 'Solução']].forEach(function (k) {
    if ((a[k[0]] || '') !== (b[k[0]] || '')) out.push({ campo: k[1], antes: a[k[0]] || '', depois: b[k[0]] || '' });
  });
  Object.keys(Object.assign({}, ca, cb)).forEach(function (k) {
    if (k === 'Solução / Escopo' && out.some(function (x) { return x.campo === 'Solução'; })) return;
    if ((ca[k] || '') !== (cb[k] || '')) out.push({ campo: k, antes: (ca[k] || '').slice(0, 300), depois: (cb[k] || '').slice(0, 300) });
  });
  return out;
}

