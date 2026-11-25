/* Formatação para a tela. Regras de leitura do card vêm de kanzo-core.js (compartilhado com o Worker). byGui */
(function (g) {
  var K = g.KanzoCore;
  if (!K) throw new Error("kanzo-core.js precisa carregar antes de format.js");
  var TZ = K.TZ;
  var STATUS = { todo: "A fazer", doing: "Em andamento", done: "Concluído", review: "Em revisão", backlog: "Backlog" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m];
    });
  }
  function toDate(x) {
    if (x == null || x === "") return null;
    var d = x instanceof Date ? x : new Date(typeof x === "number" && x < 1e12 ? x * 1000 : x);
    return isNaN(d.getTime()) ? null : d;
  }
  var fmtDH = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  var fmtD = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  function dataHora(x) { var d = toDate(x); return d ? fmtDH.format(d).replace(",", "") : "sem registro"; }
  function data(x) {
    if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) { var p = x.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
    var d = toDate(x); return d ? fmtD.format(d) : "sem data";
  }
  function relativo(x, agora) {
    var d = toDate(x); if (!d) return "sem registro";
    var s = Math.round(((agora != null ? agora : Date.now()) - d.getTime()) / 1000);
    var fut = s < 0; s = Math.abs(s);
    var t;
    if (s < 45) return "agora";
    if (s < 3600) t = Math.round(s / 60) + " min";
    else if (s < 86400) t = Math.round(s / 3600) + " h";
    else { var n = Math.round(s / 86400); t = n + (n === 1 ? " dia" : " dias"); }
    return fut ? "em " + t : "há " + t;
  }
  var diasAte = K.diasAte;
  function brl(n) {
    if (n == null || !isFinite(n)) return "sem dado";
    return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function brlCurto(n) {
    if (n == null || !isFinite(n)) return "sem dado";
    var a = Math.abs(n);
    if (a >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " mi";
    if (a >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mil";
    return brl(n);
  }
  /* Regras de leitura vêm do módulo único kanzo-core.js (o mesmo que o Worker usa). */
  var numeroBR = K.numeroBR, limpa = K.limpa, valoresDaDescricao = K.valoresDaDescricao;

  /* Pares "**Rótulo:** valor" da descrição (Responsáveis, Datas Planner, Saúde, Próxima ação...). */
  function fatos(desc) {
    var lista = K.rotulados(desc), f = { lista: lista, responsaveis: [], prazo: null, prazoPlanner: null, prazoKanzo: null, saude: null, proxima: null, situacao: null, escopo: null };
    lista.forEach(function (p) {
      var rot = p.rotulo, val = p.valor;
      if (/^Respons/i.test(rot)) f.responsaveis = val.split(",").map(function (x) { var n = x.trim(); return /^guilherme$/i.test(n) ? "Guilherme Romio Netto" : n; }).filter(Boolean);
      else if (/^Sa[uú]de/i.test(rot)) f.saude = val;
      else if (/^Pr[oó]xima a[cç][aã]o/i.test(rot)) f.proxima = val;
      else if (/^Situa[cç][aã]o/i.test(rot)) f.situacao = val;
      else if (/^Solu[cç][aã]o/i.test(rot)) f.escopo = val;
    });
    var pz = K.prazos(desc);
    f.prazoPlanner = pz.planner; f.prazoKanzo = pz.kanzo; f.prazo = pz.prazo; f.prazoFonte = pz.fonte;
    return f;
  }
  function statusLabel(s) { return STATUS[s] || s || "sem status"; }

  /* Atrasado = prazo efetivo (Kanzo > Planner) < hoje em Brasília e card não concluído (regra única em kanzo-core.js).
     Tag "atrasado" do Planner NÃO é fonte da verdade. */
  function isAtrasado(card, agora) {
    if (!card || card.deleted_at) return false;
    return K.isAtrasado(card.status, card.description, agora, card._fatos && card._fatos.prazo ? card._fatos.prazo : undefined);
  }
  /* Selo de sincronização do cabeçalho: texto curto, classe de cor e dica longa. */
  function resumoSync(s, agora) {
    if (!s) return { cls: "", txt: "Sync sem dado", tip: "Status de sincronização do Mac indisponível." };
    var on = !!s.mac_online, fila = s.pending_commands || 0, rec = s.refused_deletes || 0, ult = s.last_seen_at || s.last_push_at;
    var txt = (on ? "Mac online" : "Mac offline") + " · contato " + relativo(ult, agora) + (fila ? " · fila " + fila : "") +
      (rec ? " · " + rec + (rec === 1 ? " exclusão recusada" : " exclusões recusadas") : "");
    var falhas = (s.recent_failures || []).map(function (f) { return "• " + (f.title || "card #" + f.card_id) + ": " + f.motivo + " (" + dataHora(f.at) + ")"; });
    var tip = "Kanzo no Mac: " + (on ? "online" : "offline") + (s.mac_hostname ? " (" + s.mac_hostname + ")" : "") +
      "\nÚltimo contato do Mac: " + dataHora(ult) + " (" + relativo(ult, agora) + ")" +
      "\nÚltima alteração enviada pelo Mac: " + dataHora(s.last_push_at) + " (" + relativo(s.last_push_at, agora) + ")" +
      "\nÚltimo snapshot horário: " + dataHora(s.last_snapshot_at) + (s.last_snapshot_at ? " (" + relativo(s.last_snapshot_at, agora) + ")" : "") +
      "\nAlterações na fila para o Mac: " + fila + (s.message ? "\n" + s.message : "") +
      (falhas.length ? "\nO Mac recusou ou não aplicou (últimos 7 dias):\n" + falhas.join("\n") : "") + "\nHorários de Brasília.";
    return { cls: on ? (fila || rec ? "off" : "live") : "bad", txt: txt, tip: tip };
  }
  /* Aviso no card quando o último comando dele falhou no Mac (ex.: exclusão recusada pelo delete_guard). */
  function avisoCard(c) {
    var w = c && c.sync_warning; if (!w) return null;
    var recusa = w.tipo === "delete_refused";
    return { recusa: recusa, curto: recusa ? "exclusão recusada" : "não aplicado no Mac", motivo: w.motivo,
      tip: w.motivo + "\nEm " + dataHora(w.at) + " (Brasília)." + (recusa ? "\nO card continua no Kanzo. Confira o card e, se ainda quiser, exclua de novo." : "\nO Kanzo manteve a versão dele. Confira e refaça a alteração se precisar.") };
  }

  g.KanzoFmt = {
    resumoSync: resumoSync, avisoCard: avisoCard, TZ: TZ, esc: esc, dataHora: dataHora, data: data, relativo: relativo, diasAte: diasAte, hojeISO: K.hojeISO, brl: brl, brlCurto: brlCurto,
    numeroBR: numeroBR, valoresDaDescricao: valoresDaDescricao, fatos: fatos, statusLabel: statusLabel, STATUS: STATUS, isAtrasado: isAtrasado };
})(typeof window !== "undefined" ? window : globalThis);
