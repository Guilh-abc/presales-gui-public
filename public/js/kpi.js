/* KPIs calculados no cliente a partir dos cards reais. byGui */
(function (g) {
  var F = g.KanzoFmt;
  var GANHO = { "ganho-handoff": 1, "entregue-faturado": 1 };
  /* Famílias oficiais (Guilherme 09/11): sem balde "Outras soluções". Match exclusivo na ordem. */
  var FAMILIAS = [
    { label: "DIA / DNL", re: /dnl\s*\/\s*dia|dia\s*\/\s*dnl|dnl\/dia|dia\/dnl/i },
    { label: "DNL", re: /\bdnl\b/i },
    { label: "Locação de equipamento", re: /loca[cç][aã]o|equipamento como servi/i },
    { label: "SATELLITE / Starlink", re: /starlink|sat[eé]lit/i },
    { label: "SECURITY / Fortinet", re: /fortinet|fortigate|firewall|sase|security\s*\/\s*fortinet/i },
    { label: "SD-WAN", re: /sd-?wan/i },
    { label: "PRIVATE NETWORK", re: /privativ|private\s*network|rede\s*priv|\b5g\b|\blte\b/i },
    { label: "MVNO", re: /\bmvno\b/i },
    { label: "IoT / M2M / SIM", re: /\biot\b|m2m|sensor|sim ?cards?|e-?sim|telemetria/i },
    { label: "DIA", re: /\bdia\b|link dedicado|\bl2l\b|\bmpls\b|internet/i }
  ];
  var RESP_ALIAS = { "guilherme": "Guilherme Romio Netto" };
  function normResp(n) {
    var s = String(n || "").trim();
    var k = s.toLowerCase();
    return RESP_ALIAS[k] || s;
  }

  /* Lote 2/4: saúde e datas do Planner (só o que está escrito no card; sem data = "sem data"). */
  function slug(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var SAUDE_ROT = { "atencao": "Atenção", "no-prazo": "No prazo", "aguardando-externo": "Aguardando externo", "critico": "Crítico", "em-risco": "Em risco", "sem-dado": "Sem dado" };
  function saudeDe(c, fatos) {
    var txt = fatos && fatos.saude, key = txt ? slug(txt) : "";
    if (!key) (c.tags || []).forEach(function (t) { var m = String(t).match(/^health:(.+)$/); if (m && !key) key = slug(m[1]); });
    if (!key) key = "sem-dado";
    return { key: key, label: SAUDE_ROT[key] || txt || key };
  }
  function plannerDatas(desc) {
    var l = String(desc || "").match(/\*\*Datas Planner:\*\*([^\n]*)/), o = { criado: null, concluido: null };
    if (!l) return o;
    var a = l[1].match(/Criado em:\s*(\d{4}-\d{2}-\d{2})/i), b = l[1].match(/Conclu[ií]do em:\s*(\d{4}-\d{2}-\d{2})/i);
    if (a) o.criado = a[1]; if (b) o.concluido = b[1];
    return o;
  }

  function activeCards(cards) { return (cards || []).filter(function (c) { return c.active !== false && !c.deleted_at; }); }
  function semSolucao(c) { return !c.solution || /^a definir$/i.test(String(c.solution).trim()); }

  /* Acrescenta ao card os dados lidos da descrição (sem sobrescrever valores explícitos). */
  function enrich(c) {
    if (c._enr) return c;
    var v = c.values || {};
    var d = F.valoresDaDescricao(c.description);
    var val = { tcv: null, mrc: null, otc: null, origem: {}, fonte: {} };
    ["tcv", "mrc", "otc"].forEach(function (k) {
      if (typeof v[k] === "number") { val[k] = v[k]; val.fonte[k] = "campo do card"; val.origem[k] = v[k + "_line"] || ""; }
      else if (d[k] != null) { val[k] = d[k]; val.fonte[k] = "tabela na descrição do card"; val.origem[k] = d.origem[k]; }
    });
    val.prazo_meses = v.prazo_meses || d.prazo_meses || null;
    var f = F.fatos(c.description);
    f.responsaveis = (f.responsaveis || []).map(normResp);
    var base = Object.assign({}, c, { _enr: true, _val: val, _fatos: f, _saude: saudeDe(c, f), _planner: plannerDatas(c.description) });
    base.atrasado = F.isAtrasado(base);
    return base;
  }

  /* Lote 4: faixa de prazo (prazo efetivo: Kanzo, senão data de conclusão do Planner). */
  var FAIXA_ROT = { "vencido": "Vencido", "7d": "Próximos 7 dias", "30d": "8 a 30 dias", "depois": "Mais de 30 dias", "sem-prazo": "Sem prazo", "concluido": "Concluído", "perdido": "OLD/FALHOU" };
  function faixaPrazo(c) {
    if (c.status === "done") return "concluido";
    if (c.stage === "old-falhou") return "perdido";
    var d = c._dias;
    if (d == null) return "sem-prazo";
    return d < 0 ? "vencido" : d <= 7 ? "7d" : d <= 30 ? "30d" : "depois";
  }
  /* Evolução mensal pelas datas do Planner na descrição (Criado em / Concluído em). Sem coluna nova de fechamento: card sem data conta em "sem data". */
  function mensal(list, agora, n) {
    n = n || 12;
    var hoje = F.hojeISO(agora), y = +hoje.slice(0, 4), m = +hoje.slice(5, 7), meses = [];
    for (var i = n - 1; i >= 0; i--) { var mm = m - i, yy = y; while (mm < 1) { mm += 12; yy--; } meses.push(yy + "-" + (mm < 10 ? "0" : "") + mm); }
    var idx = {}; meses.forEach(function (k, i) { idx[k] = i; });
    var rows = meses.map(function (k) { return { mes: k, criados: 0, concluidos: 0 }; });
    var o = { meses: rows, criadosAntes: 0, semCriado: 0, concluidosAntes: 0, concluidosSemData: 0, comCriado: 0, comConcluido: 0 };
    list.forEach(function (c) {
      var p = c._planner || {}, a = p.criado && p.criado.slice(0, 7), b = p.concluido && p.concluido.slice(0, 7);
      if (a) { o.comCriado++; if (idx[a] != null) rows[idx[a]].criados++; else if (a < meses[0]) o.criadosAntes++; } else o.semCriado++;
      if (b) { o.comConcluido++; if (idx[b] != null) rows[idx[b]].concluidos++; else if (b < meses[0]) o.concluidosAntes++; }
      else if (c.status === "done") o.concluidosSemData++;
    });
    return o;
  }

  function compute(cards, stages, agora) {
    var list = activeCards(cards).map(enrich);
    var byStatus = {}, byStage = {}, porResp = {};
    var atrasadosTag = 0, atrasadosAbertos = [], acao = [], comValor = [], qual = { semSolucao: [], semValor: [], semPrioridade: [], semResponsavel: [], semPrazo: [], pendentes: [], prazoVencido: [], perdidoAberto: [] };
    list.forEach(function (c) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      var sk = c.stage || "sem-etapa";
      byStage[sk] = (byStage[sk] || 0) + 1;
      var aberto = c.status !== "done";
      if (c.atrasado) { atrasadosTag++; if (aberto) atrasadosAbertos.push(c); }
      var perdido = c.stage === "old-falhou";
      if (aberto && perdido) qual.perdidoAberto.push(c);
      if (aberto && !perdido && (c.atrasado || c.status === "todo" || c.status === "doing")) acao.push(c);
      if (c._val.tcv != null) comValor.push(c);
      if (semSolucao(c)) qual.semSolucao.push(c);
      if (aberto && c._val.tcv == null && !GANHO[c.stage] && c.stage !== "old-falhou") qual.semValor.push(c);
      if (GANHO[c.stage] && c._val.tcv == null) qual.semValor.push(c);
      if (!c.priority && !c.prioridade) qual.semPrioridade.push(c);
      if (!c._fatos.responsaveis.length) qual.semResponsavel.push(c);
      if (aberto && !c._fatos.prazo) qual.semPrazo.push(c);
      if (c.pending) qual.pendentes.push(c);
      var dias = F.diasAte(c._fatos.prazo, agora);
      c._dias = dias;
      if (aberto && !perdido && dias != null && dias < 0) qual.prazoVencido.push(c);
      if (aberto) c._fatos.responsaveis.forEach(function (r) { r = normResp(r); (porResp[r] = porResp[r] || []).push(c); });
    });
    acao.sort(function (a, b) {
      if (!!b.atrasado - !!a.atrasado) return !!b.atrasado - !!a.atrasado;
      var da = a._dias == null ? 1e9 : a._dias, db = b._dias == null ? 1e9 : b._dias;
      if (da !== db) return da - db;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    comValor.sort(function (a, b) { return b._val.tcv - a._val.tcv; });
    var ganhos = list.filter(function (c) { return GANHO[c.stage]; });
    var tcvSoma = comValor.reduce(function (s, c) { return s + c._val.tcv; }, 0);
    var mrcSoma = comValor.reduce(function (s, c) { return s + (c._val.mrc || 0); }, 0);
    function somaTcv(cs) { var t = 0, n = 0; cs.forEach(function (c) { if (c._val.tcv != null) { t += c._val.tcv; n++; } }); return { tcv: t, comTcv: n }; }
    var funil = (stages || []).map(function (s) {
      var cs = list.filter(function (c) { return c.stage === s.key; }), st = somaTcv(cs);
      return { key: s.key, label: s.label, count: cs.length, abertos: cs.filter(function (c) { return c.status !== "done"; }).length,
        atrasados: cs.filter(function (c) { return c.atrasado && c.status !== "done"; }).length, tcv: st.tcv, comTcv: st.comTcv };
    });
    var semEtapa = list.filter(function (c) { return !(stages || []).some(function (s) { return s.key === c.stage; }); });
    if (semEtapa.length) { var se = somaTcv(semEtapa); funil.push({ key: "", label: "Sem etapa conhecida", count: semEtapa.length, abertos: semEtapa.length, atrasados: 0, tcv: se.tcv, comTcv: se.comTcv }); }
    /* Lote 3: valor GANHO separado do valor EM ABERTO (antes era uma soma única). Fora dos dois: concluídos sem ganho e OLD/FALHOU. */
    var ganhosL = list.filter(function (c) { return GANHO[c.stage]; });
    var abertosL = list.filter(function (c) { return c.status !== "done" && !GANHO[c.stage] && c.stage !== "old-falhou"; });
    function soma(cs, k) { return cs.reduce(function (s, c) { return s + (c._val[k] || 0); }, 0); }
    var gTcv = ganhosL.filter(function (c) { return c._val.tcv != null; }), aTcv = abertosL.filter(function (c) { return c._val.tcv != null; });
    var diretoria = {
      ganhos: ganhosL.length, ganhosComTcv: gTcv.length, tcvGanho: soma(gTcv, "tcv"), mrcGanho: soma(gTcv, "mrc"), otcGanho: soma(gTcv, "otc"),
      ganhosComMrc: gTcv.filter(function (c) { return c._val.mrc != null; }).length, ganhosComOtc: gTcv.filter(function (c) { return c._val.otc != null; }).length,
      abertos: abertosL.length, abertosComTcv: aTcv.length, tcvAberto: soma(aTcv, "tcv"),
      foraTcv: comValor.length - gTcv.length - aTcv.length,
      emAtencao: list.filter(function (c) { return c.status !== "done" && c._saude && c._saude.key === "atencao"; })
    };
    var claimed = {};
    var familias = FAMILIAS.map(function (f) {
      return { label: f.label, cards: list.filter(function (c) {
        if (semSolucao(c) || claimed[c.id]) return false;
        if (f.re.test(c.solution)) { claimed[c.id] = 1; return true; }
        return false;
      }) };
    });
    familias.forEach(function (f) { var st = somaTcv(f.cards); f.tcv = st.tcv; f.comTcv = st.comTcv; });
    familias = familias.filter(function (f) { return f.cards.length; }).sort(function (a, b) { return b.cards.length - a.cards.length; });
    var responsaveis = Object.keys(porResp).map(function (k) { return { label: k, cards: porResp[k] }; })
      .sort(function (a, b) { return b.cards.length - a.cards.length; });
    return {
      list: list, total: list.length, abertos: list.filter(function (c) { return c.status !== "done"; }).length,
      byStatus: byStatus, byStage: byStage, atrasadosTag: atrasadosTag, atrasadosAbertos: atrasadosAbertos,
      acao: acao, ganhos: ganhos, comValor: comValor, tcvSoma: tcvSoma, mrcSoma: mrcSoma, funil: funil,
      familias: familias, responsaveis: responsaveis, qualidade: qual, diretoria: diretoria,
      prazos: (function () { var f = {}; list.forEach(function (c) { var k = faixaPrazo(c); c._faixa = k; f[k] = (f[k] || 0) + 1; }); return f; })(),
      saude: (function () { var s = {}; list.forEach(function (c) { if (c.status === "done") return; s[c._saude.key] = (s[c._saude.key] || 0) + 1; }); return s; })(),
      mensal: mensal(list, agora)
    };
  }
  function brl(n) { return F.brl(n); }
  g.KanzoKPI = { FAIXA_ROT: FAIXA_ROT, faixaPrazo: faixaPrazo, mensal: mensal, GANHO: GANHO, slug: slug, saudeDe: saudeDe, plannerDatas: plannerDatas, SAUDE_ROT: SAUDE_ROT, compute: compute, activeCards: activeCards, enrich: enrich, semSolucao: semSolucao, brl: brl, FAMILIAS: FAMILIAS, normResp: normResp };
})(typeof window !== "undefined" ? window : globalThis);
