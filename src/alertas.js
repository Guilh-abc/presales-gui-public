/* presales-kanzo · src/alertas.js — Alertas de prazo e relatório diário de projetos (12/11/2026, pedido do Guilherme).
   Regras fixas:
   - Só usa prazos JÁ gravados: due_date das tarefas pendentes (card_tasks) e "Prazo (Kanzo)" / "Datas Planner" da descrição do card.
     Nunca cria nem altera prazo; nada aqui escreve em cards ou card_tasks.
   - Dias contados no fuso America/Sao_Paulo (K.hojeISO / K.diasAte, o mesmo do painel).
   - Tempo gasto = done_at − started_at, só quando as DUAS marcas existem (started_at é gravado ao criar a tarefa pendente,
     em task_times, a partir da migração 8). Sem as duas: "sem registro de tempo". Nunca estima.
   - Aviso no app: GET /api/alertas (só admin) devolve só itens com prazo gravado na janela de 8 h (ou já vencidos no mesmo dia, em Brasília) e grava meta.last_seen_at (abertura do app). Sem pilha de pendências.
   - E-mail: cron de dia útil às 18:00 de Brasília (21:00 UTC). Vai só para o admin (ADMIN_EMAIL), só se houver binding EMAIL e
     remetente configurado (meta alert_email_from) e, no modo padrão, só se o app não foi aberto no dia. Cada execução fica em alert_runs. */
'use strict';
import { ADMIN_EMAIL, STAGE_ORDER, STAGE_LABEL } from './config.js';
import { dataDB, metaGet, metaSet } from './db.js';
import { K } from './format.js';
import { iso } from './util.js';

export var CARDS_MVNO_PADRAO = [200354, 200353]; // ISA (DT IoT) e Claro MVNO; configurável em meta.alert_cards ("id,id,...")
var STATUS_LABEL = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído', review: 'Em revisão', backlog: 'Backlog' };
var RE_APROV = /aprova/i;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
export function dataBR(d) { return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
/* Dia (AAAA-MM-DD) em Brasília de um instante ISO. */
export function diaSP(instante) { return instante ? K.hojeISO(Date.parse(instante)) : null; }
export function textoDias(d) {
  if (d == null) return '';
  if (d < 0) return 'atrasado ' + (-d) + (d === -1 ? ' dia' : ' dias');
  if (d === 0) return 'vence hoje';
  return 'faltam ' + d + (d === 1 ? ' dia' : ' dias');
}

/* Instantâneo do prazo gravado, em ms. Só data (AAAA-MM-DD ou DD/MM/AAAA) = 23:59:00 em Brasília.
   Se o valor já tiver hora, usa essa hora (fuso explícito se houver; senão Brasília). Nunca inventa prazo. */
var JANELA_8H_MS = 8 * 60 * 60 * 1000;
var TZ_SP = 'America/Sao_Paulo';
function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function instantePrazo(valor) {
  if (valor == null || valor === '') return null;
  var s = String(valor).trim(), m, ymd, h, mi, se, tz;
  m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return epochSP(m[1], 23, 59, 0);
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/);
  if (m) {
    if (m[5]) { var ms = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + (m[4] || '00') + m[5]); return isFinite(ms) ? ms : null; }
    return epochSP(m[1], +m[2], +m[3], +(m[4] || 0));
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    ymd = m[3] + '-' + m[2] + '-' + m[1];
    return m[4] != null ? epochSP(ymd, +m[4], +m[5], +(m[6] || 0)) : epochSP(ymd, 23, 59, 0);
  }
  return null;
}
function epochSP(ymd, h, mi, se) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  var guess = Date.parse(ymd + 'T' + pad2(h) + ':' + pad2(mi) + ':' + pad2(se) + 'Z');
  if (!isFinite(guess)) return null;
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ_SP, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function parede(ms) {
    var o = {}, p = fmt.formatToParts(new Date(ms));
    p.forEach(function (x) { o[x.type] = x.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
  }
  var wanted = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), h, mi, se);
  var inst = guess + (wanted - parede(guess));
  inst = inst + (wanted - parede(inst));
  return inst;
}
export function diaISODe(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_SP }).format(new Date(ms)); }
/* Início do dia seguinte, em Brasília, ao dia do instante (limite exclusivo da janela no dia do vencimento). */
export function inicioProximoDiaSP(ms) {
  var dia = diaISODe(ms), p = dia.split('-');
  var next = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12, 0, 0) + 86400000).toISOString().slice(0, 10);
  return epochSP(next, 0, 0, 0);
}
export function naJanela8h(inst, agora) {
  if (inst == null || !isFinite(inst)) return false;
  agora = agora != null ? agora : Date.now();
  return agora >= inst - JANELA_8H_MS && agora < inicioProximoDiaSP(inst);
}
export function textoHoras(msRestantes) {
  if (msRestantes == null || !isFinite(msRestantes)) return '';
  var atrasado = msRestantes < 0, abs = Math.abs(msRestantes);
  var min = Math.round(abs / 60000);
  if (min <= 0) return atrasado ? 'venceu agora' : 'vence agora';
  var h = Math.floor(min / 60), m = min % 60, corpo;
  if (h && m) corpo = h + ' h ' + m + ' min';
  else if (h) corpo = h + ' h';
  else corpo = min + ' min';
  if (atrasado) return 'vencido há ' + corpo;
  return (h === 0 && min === 1 ? 'falta ' : 'faltam ') + corpo;
}
function prazoBrCompleto(valor, inst) {
  var soData = /^\d{4}-\d{2}-\d{2}$/.test(String(valor || '').trim()) || /^\d{2}\/\d{2}\/\d{4}$/.test(String(valor || '').trim());
  var d = dataBR(diaISODe(inst));
  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ_SP, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return d + ' ' + fmt.format(new Date(inst));
}

export function duracao(ini, fim) {
  if (!ini || !fim) return null;
  var ms = Date.parse(fim) - Date.parse(ini); if (!isFinite(ms) || ms < 0) return null;
  var min = Math.round(ms / 60000);
  if (min < 60) return min + ' min';
  var h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return h + ' h' + (m ? ' ' + m + ' min' : '');
  var dd = Math.floor(h / 24), hh = h % 24;
  return dd + (dd === 1 ? ' dia' : ' dias') + (hh ? ' ' + hh + ' h' : '');
}

async function cardsConfigurados(env) {
  var v = await metaGet(env, 'alert_cards');
  if (!v) return CARDS_MVNO_PADRAO.slice();
  return v.split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });
}
function campo(desc, re) {
  var r = K.rotulados(desc); for (var i = 0; i < r.length; i++) if (re.test(r[i].rotulo)) return r[i].valor;
  return null;
}
function curto(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }

/* Monta a visão de todos os cards não excluídos. agora: ms (opcional, para teste). */
export async function coletar(env, agora) {
  var db = dataDB(env), hoje = K.hojeISO(agora), mvno = await cardsConfigurados(env);
  var cards = (await db.prepare('SELECT id, title, stage, status, description, updated_at FROM cards WHERE deleted_at IS NULL').all()).results || [];
  var tarefas = (await db.prepare('SELECT t.*, tt.started_at AS started_at FROM card_tasks t LEFT JOIN task_times tt ON tt.task_id = t.id WHERE t.deleted_at IS NULL AND t.dismissed = 0 ORDER BY t.card_id, t.done, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.position, t.id').all()).results || [];
  var porCard = {}; tarefas.forEach(function (t) { (porCard[t.card_id] = porCard[t.card_id] || []).push(t); });
  var lista = cards.map(function (c) {
    var ts = (porCard[c.id] || []).map(function (t) {
      var dias = t.done ? null : K.diasAte(t.due_date, agora);
      return { id: t.id, titulo: t.title, done: !!t.done, prazo: t.due_date || null, dias: dias, done_at: t.done_at || null,
        tempo: t.done ? duracao(t.started_at, t.done_at) : null, aprovacao: !t.done && RE_APROV.test(t.title) };
    });
    var pend = ts.filter(function (t) { return !t.done; });
    var comPrazo = pend.filter(function (t) { return t.prazo; });
    var pz = K.prazos(c.description), prazoCard = c.status === 'done' ? null : pz.prazo;
    var saude = campo(c.description, /^Saúde$/i);
    var acaoDesc = campo(c.description, /^Próxima ação/i);
    /* Próxima ação: tarefa com prazo vencido ou em até 7 dias > "Próxima ação" escrita no card > tarefa com prazo mais próximo > 1ª pendente.
       O prazo mostrado é sempre o da própria tarefa ou o do card; quando a ação vem do card, o prazo de tarefa mais próximo aparece à parte. */
    var acao = null, prazo = null, fonte = null, prox = comPrazo[0] || null;
    if (prox && prox.dias != null && prox.dias <= 7) { acao = prox.titulo; prazo = prox.prazo; fonte = 'tarefa'; }
    else if (acaoDesc && (c.status !== 'done' || pend.length)) { acao = acaoDesc; fonte = 'card'; prazo = prazoCard; }
    else if (prox) { acao = prox.titulo; prazo = prox.prazo; fonte = 'tarefa'; }
    else if (pend.length) { acao = pend[0].titulo; fonte = 'tarefa'; prazo = prazoCard; }
    else if (acaoDesc) { acao = acaoDesc; fonte = 'card'; }
    if (!prazo && prazoCard && fonte !== 'tarefa') prazo = prazoCard;
    var proxPrazo = prox && prox.prazo !== prazo ? { titulo: curto(prox.titulo, 120), prazo: prox.prazo, dias: prox.dias } : null;
    var ativo = c.status !== 'done' || pend.length > 0;
    var dias = prazo ? K.diasAte(prazo, agora) : null;
    var falta = [];
    if (!saude) falta.push('saúde');
    if (ativo && !acao) falta.push('próxima ação');
    if (ativo && !prazo) falta.push('prazo');
    return {
      id: c.id, titulo: c.title, stage: c.stage || '', etapa: STAGE_LABEL[c.stage] || c.stage || 'sem etapa', status: c.status,
      status_label: STATUS_LABEL[c.status] || c.status, saude: saude, acao: acao, acao_curta: acao ? curto(acao, 220) : null, fonte_acao: fonte,
      prazo: prazo, dias: dias, prazo_fonte: prazo ? (fonte === 'tarefa' ? 'tarefa' : (pz.fonte || 'card')) : null, prox_prazo: proxPrazo,
      ativo: ativo, mvno: mvno.indexOf(c.id) >= 0, tarefas: ts, pendentes: pend.length, falta: falta,
      atrasadas: pend.filter(function (t) { return t.dias != null && t.dias < 0; }).length + (prazoCard && !comPrazo.length && dias != null && dias < 0 ? 1 : 0),
      concluidas_hoje: ts.filter(function (t) { return t.done && diaSP(t.done_at) === hoje; }),
      aguardando: pend.filter(function (t) { return t.aprovacao; }).length + (c.status !== 'done' && c.stage === 'processo-aprovacao-precificacao' ? 1 : 0)
    };
  });
  function urg(x) { var a = x.dias == null ? 99999 : x.dias, b = x.prox_prazo && x.prox_prazo.dias != null ? x.prox_prazo.dias : 99999; return Math.min(a, b); }
  lista.sort(function (a, b) {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    if (a.mvno !== b.mvno) return a.mvno ? -1 : 1;
    if (a.mvno && b.mvno) return mvno.indexOf(a.id) - mvno.indexOf(b.id);
    return urg(a) - urg(b) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
  var ativos = lista.filter(function (x) { return x.ativo; });
  var resumo = {
    hoje: hoje, total: lista.length, ativos: ativos.length,
    concluidas_hoje: lista.reduce(function (n, x) { return n + x.concluidas_hoje.length; }, 0),
    atrasadas: lista.reduce(function (n, x) { return n + x.atrasadas; }, 0),
    proximos7: lista.reduce(function (n, x) { return n + x.tarefas.filter(function (t) { return !t.done && t.dias != null && t.dias >= 0 && t.dias <= 7; }).length + (x.ativo && x.prazo_fonte && x.prazo_fonte !== 'tarefa' && x.dias != null && x.dias >= 0 && x.dias <= 7 ? 1 : 0); }, 0),
    aguardando: lista.reduce(function (n, x) { return n + x.aguardando; }, 0),
    insuficientes: lista.filter(function (x) { return x.falta.length; }).length
  };
  return { resumo: resumo, cards: lista, mvno: mvno };
}

/* Avisos do app: um por card com pendência (em andamento ou com tarefa pendente). */
export function avisos(v) {
  return v.cards.filter(function (x) { return x.ativo; }).map(function (x) {
    return { card_id: x.id, card: x.titulo, acao: x.acao_curta, prazo: x.prazo, prazo_br: dataBR(x.prazo), dias: x.dias, dias_txt: x.prazo ? textoDias(x.dias) : 'sem prazo definido',
      atrasado: x.dias != null && x.dias < 0, mvno: x.mvno, falta: x.falta,
      prox_prazo: x.prox_prazo ? { titulo: x.prox_prazo.titulo, prazo_br: dataBR(x.prox_prazo.prazo), dias_txt: textoDias(x.prox_prazo.dias), dias: x.prox_prazo.dias } : null };
  });
}

/* Itens na janela de 8 h: cada tarefa pendente com due_date gravado, e o prazo do card (Kanzo/Planner) se o card estiver ativo.
   A "próxima ação" só entra se tiver prazo gravado (já coberto pela tarefa ou pelo prazo do card). Nada é inventado. */
function itemJanela(id, tipo, x, titulo, prazo, agora) {
  var inst = instantePrazo(prazo);
  if (!naJanela8h(inst, agora)) return null;
  var rest = inst - agora;
  return {
    id: id, tipo: tipo, card_id: x.id, card: x.titulo, titulo: curto(titulo, 160),
    prazo: prazo, prazo_em: diaISODe(inst) + 'T' + prazoBrCompleto(prazo, inst).slice(-5) + ':00',
    prazo_br: prazoBrCompleto(prazo, inst), ms: rest, restante_txt: textoHoras(rest), vencido: rest <= 0
  };
}
export function itensJanela8h(v, agora) {
  agora = agora != null ? (typeof agora === 'number' ? agora : Date.parse(agora)) : Date.now();
  if (!isFinite(agora)) agora = Date.now();
  var out = [];
  (v.cards || []).forEach(function (x) {
    (x.tarefas || []).forEach(function (t) {
      if (t.done || !t.prazo) return;
      var it = itemJanela('tarefa:' + t.id, 'tarefa', x, t.titulo, t.prazo, agora);
      if (it) out.push(it);
    });
    if (x.ativo && x.prazo && x.prazo_fonte && x.prazo_fonte !== 'tarefa') {
      var titulo = x.acao_curta ? ('Prazo do card · ' + x.acao_curta) : 'Prazo do card';
      var itc = itemJanela('card:' + x.id, 'prazo_card', x, titulo, x.prazo, agora);
      if (itc) out.push(itc);
    }
  });
  out.sort(function (a, b) { return a.ms - b.ms || String(a.card).localeCompare(String(b.card), 'pt-BR'); });
  return out;
}

/* ---------- HTML do e-mail (tabelas + CSS inline; Gmail/Outlook; sóbrio; legível no celular) ---------- */
var COR = { tx: '#1F2937', tx2: '#4B5563', tx3: '#6B7280', linha: '#E5E7EB', fundo: '#F4F5F7', card: '#FFFFFF', acento: '#33507A', alerta: '#9A3B3B', aviso: '#8A6A1F', ok: '#3F6B4E', suave: '#F8F9FB' };
var FONTE = "font-family:Arial,Helvetica,sans-serif;";
function selo(txt, cor) { return '<span style="' + FONTE + 'display:inline-block;padding:2px 8px;border:1px solid ' + cor + ';border-radius:10px;color:' + cor + ';font-size:12px;line-height:16px;white-space:nowrap">' + esc(txt) + '</span>'; }
function corDias(d) { return d == null ? COR.tx3 : d < 0 ? COR.alerta : d <= 3 ? COR.aviso : COR.tx2; }
function linhaPrazo(x) {
  if (!x.prazo) return '<span style="color:' + COR.tx3 + '">sem prazo definido</span>';
  return esc(dataBR(x.prazo)) + ' · <b style="color:' + corDias(x.dias) + '">' + esc(textoDias(x.dias)) + '</b>';
}
function faltaHtml(x) { return x.falta.length ? '<div style="' + FONTE + 'font-size:12px;color:' + COR.aviso + ';margin-top:6px">Sem dados suficientes: falta ' + esc(x.falta.join(', ')) + '.</div>' : ''; }

function blocoCompleto(x, url) {
  var tar = x.tarefas.length ? x.tarefas.map(function (t) {
    var st = t.done ? 'Feita' + (t.done_at ? ' em ' + dataBR(diaSP(t.done_at)) : '') : 'Pendente';
    var pz = t.done ? '' : t.prazo ? dataBR(t.prazo) + ' · ' + textoDias(t.dias) : 'sem prazo';
    return '<tr><td style="' + FONTE + 'padding:6px 0;border-top:1px solid ' + COR.linha + ';font-size:13px;color:' + (t.done ? COR.tx3 : COR.tx) + ';vertical-align:top">' + (t.done ? '&#10003; ' : '&#9675; ') + esc(t.titulo) +
      '<div style="font-size:12px;color:' + COR.tx3 + ';margin-top:2px">' + esc(st) + (pz ? ' · <span style="color:' + corDias(t.dias) + '">' + esc(pz) + '</span>' : '') +
      ' · Tempo gasto: ' + esc(t.done ? (t.tempo || 'sem registro de tempo') : 'em aberto') + '</div></td></tr>';
  }).join('') : '<tr><td style="' + FONTE + 'padding:6px 0;border-top:1px solid ' + COR.linha + ';font-size:13px;color:' + COR.tx3 + '">Sem tarefas no card.</td></tr>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COR.card + ';border:1px solid ' + COR.linha + ';border-left:3px solid ' + (x.dias != null && x.dias < 0 ? COR.alerta : x.mvno ? COR.acento : COR.linha) + ';border-radius:6px;margin:0 0 12px 0">' +
    '<tr><td style="' + FONTE + 'padding:14px 16px">' +
    '<div style="font-size:15px;font-weight:bold;color:' + COR.tx + ';line-height:20px"><a href="' + esc(url) + '" style="color:' + COR.tx + ';text-decoration:none">' + esc(x.titulo) + '</a> <span style="font-weight:normal;color:' + COR.tx3 + ';font-size:12px">#' + x.id + (x.mvno ? ' · MVNO' : '') + '</span></div>' +
    '<div style="margin-top:6px;line-height:22px">' + selo(x.etapa, COR.tx2) + ' ' + selo(x.status_label, COR.tx2) + ' ' + selo('Saúde: ' + (x.saude || 'sem dado'), x.saude && /risco|crít/i.test(x.saude) ? COR.alerta : x.saude && /aten/i.test(x.saude) ? COR.aviso : COR.tx2) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background:' + COR.suave + ';border-radius:4px"><tr><td style="' + FONTE + 'padding:10px 12px;font-size:13px;color:' + COR.tx + ';line-height:19px">' +
    '<div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:' + COR.tx3 + '">Próxima ação</div>' + esc(x.acao_curta || 'sem próxima ação registrada') +
    '<div style="margin-top:4px;font-size:13px">Prazo: ' + linhaPrazo(x) + '</div>' +
    (x.prox_prazo ? '<div style="margin-top:4px;font-size:12px;color:' + COR.tx2 + '">Próximo prazo gravado em tarefa: ' + esc(x.prox_prazo.titulo) + ' · ' + linhaPrazo(x.prox_prazo) + '</div>' : '') +
    '</td></tr></table>' + faltaHtml(x) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px">' + tar + '</table>' +
    '</td></tr></table>';
}

function linhaCompacta(x) {
  var falta = x.falta.length ? '<div style="font-size:11px;color:' + COR.aviso + '">Sem dados suficientes: falta ' + esc(x.falta.join(', ')) + '.</div>' : '';
  var tars = x.tarefas.length ? x.tarefas.length + ' tarefa(s), ' + x.tarefas.filter(function (t) { return t.tempo; }).length + ' com tempo registrado' : 'sem tarefas';
  return '<tr><td style="' + FONTE + 'padding:7px 0;border-top:1px solid ' + COR.linha + ';font-size:13px;color:' + COR.tx + ';line-height:18px">' + esc(x.titulo) +
    ' <span style="color:' + COR.tx3 + ';font-size:11px">#' + x.id + '</span>' +
    '<div style="font-size:12px;color:' + COR.tx3 + '">' + esc(x.status_label) + ' · Saúde: ' + esc(x.saude || 'sem dado') + ' · Próxima ação: ' + esc(x.acao_curta ? curto(x.acao_curta, 90) : 'nenhuma pendente') + ' · ' + esc(tars) + '</div>' + falta + '</td></tr>';
}

export function relatorioHtml(v, base) {
  var r = v.resumo, url = function (id) { return (base || '') + '/?card=' + id; };
  function kpi(n, rot, cor) {
    return '<td width="20%" align="center" style="' + FONTE + 'padding:10px 4px;border:1px solid ' + COR.linha + ';background:' + COR.card + '"><div style="font-size:22px;font-weight:bold;color:' + (cor || COR.tx) + '">' + n + '</div><div style="font-size:11px;color:' + COR.tx3 + ';line-height:14px">' + rot + '</div></td>';
  }
  var ativos = v.cards.filter(function (x) { return x.ativo; }), outros = v.cards.filter(function (x) { return !x.ativo; });
  var grupos = {}; outros.forEach(function (x) { (grupos[x.stage] = grupos[x.stage] || []).push(x); });
  var ordem = STAGE_ORDER.concat(Object.keys(grupos).filter(function (k) { return STAGE_ORDER.indexOf(k) < 0; }));
  var compacto = ordem.filter(function (k) { return grupos[k]; }).map(function (k) {
    return '<tr><td style="' + FONTE + 'padding:12px 0 2px 0;font-size:12px;font-weight:bold;color:' + COR.tx2 + ';text-transform:uppercase;letter-spacing:.04em">' + esc(STAGE_LABEL[k] || k || 'sem etapa') + ' (' + grupos[k].length + ')</td></tr>' + grupos[k].map(linhaCompacta).join('');
  }).join('');
  var feitasHoje = v.cards.filter(function (x) { return x.concluidas_hoje.length; }).map(function (x) {
    return esc(curto(x.titulo, 60)) + ': <b>' + x.concluidas_hoje.length + '</b>';
  });
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Relatório diário de projetos · ' + esc(dataBR(r.hoje)) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + COR.fundo + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COR.fundo + '"><tr><td align="center" style="padding:16px 8px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px">' +
    '<tr><td style="' + FONTE + 'padding:4px 4px 12px 4px"><div style="font-size:12px;color:' + COR.tx3 + '">Plataforma - Controle Geral de Pré Venda</div>' +
    '<div style="font-size:20px;font-weight:bold;color:' + COR.tx + ';margin-top:2px">Relatório diário de projetos · ' + esc(dataBR(r.hoje)) + '</div></td></tr>' +
    '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>' +
    kpi(r.ativos, 'projetos com pendência<br>(de ' + r.total + ' no app)') + kpi(r.concluidas_hoje, 'tarefas marcadas<br>como feitas hoje', COR.ok) +
    kpi(r.atrasadas, 'atrasadas', r.atrasadas ? COR.alerta : null) + kpi(r.proximos7, 'vencem em 7 dias', r.proximos7 ? COR.aviso : null) + kpi(r.aguardando, 'aguardando aprovação') +
    '</tr></table></td></tr>' +
    (feitasHoje.length ? '<tr><td style="' + FONTE + 'padding:10px 4px 0 4px;font-size:13px;color:' + COR.tx2 + ';line-height:19px"><b>Marcado como feito hoje, por card:</b> ' + feitasHoje.join(' · ') + ' <span style="color:' + COR.tx3 + '">(detalhe em cada card abaixo)</span></td></tr>' : '') +
    '<tr><td style="' + FONTE + 'padding:18px 4px 8px 4px;font-size:14px;font-weight:bold;color:' + COR.tx + '">Projetos com pendência, do mais urgente ao menos (' + ativos.length + ')</td></tr>' +
    '<tr><td>' + (ativos.map(function (x) { return blocoCompleto(x, url(x.id)); }).join('') || '<div style="' + FONTE + 'font-size:13px;color:' + COR.tx3 + '">Nenhum projeto com pendência.</div>') + '</td></tr>' +
    '<tr><td style="' + FONTE + 'padding:14px 4px 0 4px;font-size:14px;font-weight:bold;color:' + COR.tx + '">Sem pendência, por etapa (' + outros.length + ')</td></tr>' +
    '<tr><td style="padding:0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + compacto + '</table></td></tr>' +
    '<tr><td style="' + FONTE + 'padding:18px 4px;font-size:11px;color:' + COR.tx3 + ';line-height:16px">Datas e dias no horário de Brasília. Prazos só os gravados nas tarefas ou no card (Prazo Kanzo / Planner); nada é estimado. ' +
    'Tempo gasto = da criação da tarefa (registrada a partir de 12/11/2026) até a conclusão; sem as duas marcas, "sem registro de tempo". ' +
    '"Aguardando aprovação" = tarefa pendente com "aprova" no texto ou card na etapa Aprovação precificação. Cards com dados insuficientes: ' + r.insuficientes + ' de ' + r.total + '.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

export function relatorioTexto(v) {
  var r = v.resumo, out = ['Relatório diário de projetos · ' + dataBR(r.hoje), '',
    r.ativos + ' projetos com pendência (de ' + r.total + ') · ' + r.concluidas_hoje + ' concluídas hoje · ' + r.atrasadas + ' atrasadas · ' + r.proximos7 + ' vencem em 7 dias · ' + r.aguardando + ' aguardando aprovação', ''];
  v.cards.filter(function (x) { return x.ativo; }).forEach(function (x) {
    out.push('■ ' + x.titulo + ' (#' + x.id + ') · ' + x.etapa + ' · ' + x.status_label + ' · Saúde: ' + (x.saude || 'sem dado'));
    out.push('  Próxima ação: ' + (x.acao_curta || 'sem próxima ação') + ' · Prazo: ' + (x.prazo ? dataBR(x.prazo) + ' (' + textoDias(x.dias) + ')' : 'sem prazo definido'));
    if (x.falta.length) out.push('  Sem dados suficientes: falta ' + x.falta.join(', '));
  });
  return out.join('\n');
}

/* GET /api/alertas (só admin): itens na janela de 8 h + grava a abertura do app (o e-mail das 18 h usa last_seen_at).
   agora opcional (ms ou ISO) só para teste/prévia; em produção o relógio é o do servidor. */
export async function apiAlertas(env, s, agora) {
  await metaSet(env, 'last_seen_at', iso());
  var v = await coletar(env, agora);
  return { hoje: v.resumo.hoje, resumo: v.resumo, avisos: [], itens: itensJanela8h(v, agora) };
}

/* Cron: dia útil, 21:00 UTC = 18:00 em Brasília. */
export async function rodarCron(env, opts) {
  opts = opts || {};
  var agora = opts.agora, hoje = K.hojeISO(agora), db = dataDB(env);
  var dow = new Date(Date.parse(hoje + 'T12:00:00Z')).getUTCDay();
  var v = await coletar(env, agora), visto = await metaGet(env, 'last_seen_at'), abriuHoje = diaSP(visto) === hoje;
  var modo = (await metaGet(env, 'alert_email_modo')) || 'sem_abertura', from = await metaGet(env, 'alert_email_from');
  var jaEnviou = await db.prepare("SELECT id FROM alert_runs WHERE day_sp = ? AND email_status = 'enviado' LIMIT 1").bind(hoje).first();
  var st;
  if (dow === 0 || dow === 6) st = 'fim_de_semana';
  else if (!v.resumo.ativos) st = 'sem_pendencia';
  else if (modo !== 'sempre' && abriuHoje) st = 'app_aberto_hoje';
  else if (jaEnviou) st = 'ja_enviado_hoje';
  else if (opts.dryRun) st = 'simulado';
  else if (!env.EMAIL || typeof env.EMAIL.send !== 'function' || !from) st = 'sem_canal_email';
  else {
    try {
      await env.EMAIL.send({ from: from, to: ADMIN_EMAIL, subject: 'Pré-vendas · ' + v.resumo.ativos + ' projetos com pendência · ' + dataBR(hoje),
        html: relatorioHtml(v, opts.base || 'https://SEU-WORKER.SUA-CONTA.workers.dev'), text: relatorioTexto(v) });
      st = 'enviado';
    } catch (e) { st = 'erro: ' + String(e && e.message || e).slice(0, 200); }
  }
  if (!opts.semRegistro) {
    await db.prepare('INSERT INTO alert_runs (run_at, day_sp, kind, app_opened, pending_count, email_status, detail_json) VALUES (?,?,?,?,?,?,?)')
      .bind(iso(), hoje, opts.kind || 'cron', abriuHoje ? 1 : 0, v.resumo.ativos, st, JSON.stringify(v.resumo)).run();
  }
  return { hoje: hoje, email: st, app_aberto_hoje: abriuHoje, resumo: v.resumo };
}
