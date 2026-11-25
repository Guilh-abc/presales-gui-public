/* Kanzo Pré-vendas · cockpit. HTML/CSS/JS puro. byGui */
(function (g) {
  "use strict";
  /* Helpers puros do Salvar e da mudança de etapa (testados em tests/descricao-stale.test.mjs). */
  function patchMoverEtapa(stage) { return { stage: stage }; }
  function patchSalvarDrawer(opts) {
    opts = opts || {};
    var prev = opts.prev || {}, patch = {};
    if (opts.title != null && String(opts.title).trim() !== (prev.title || "")) patch.title = String(opts.title).trim();
    /* Etapa não entra neste patch: só patchMoverEtapa (#d-stage, quadro, Mover para). */
    if (opts.status != null && opts.status !== prev.status) patch.status = opts.status;
    /* Só reenvia a descrição se o usuário alterou o texto avançado (#f-desc) em relação
       ao que estava no drawer ao abrir. Comparar com prev.description (já atualizado
       pelos campos) apagava TCV/MRC, como no CLIENTE DELTA F200G em 17/11/2026. */
    if (opts.descHabilitada && opts.descNovo != null && opts.descNovo !== (opts.descInicial || "")) patch.description = opts.descNovo;
    return patch;
  }
  g.KanzoDrawerPatch = { patchMoverEtapa: patchMoverEtapa, patchSalvarDrawer: patchSalvarDrawer };
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  "use strict";
  var F = window.KanzoFmt, K = window.KanzoKPI, C = window.KanzoCharts, T = window.KanzoTarefas, D = window.KanzoDocs, FL = window.KanzoFields;
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = F.esc;
  var state = { live: false, cards: [], stages: [], meta: {}, me: null, sync: null, label: "", loadedAt: null, k: null, view: "list", visao: "carteira", tasks: null, tasksErro: "", tkEdit: null,
    filter: filtroPadrao(), acaoAll: false, kCache: {} };
  function filtroPadrao() { return { q: "", stage: "", status: "", chip: "abertos", fam: "", resp: "", saude: "", periodo: "", prazo: "", sort: "acao", limit: 25 }; }
  var selectedId = null, lastOpener = null, descDrawerInicial = "";
  var MOBILE = window.matchMedia ? window.matchMedia("(max-width: 640px)") : { matches: false };
  var STATUS_COR = { todo: "var(--warn)", doing: "var(--accent)", done: "var(--ok)", review: "var(--c3)", backlog: "var(--text-3)" };

  var docsCtl = null; /* 18/11: Documentos e links do card (docs.js) */
  function canWrite() { return !!(state.live && state.me && state.me.papel === "admin"); }
  function toast(msg, acao) {
    var t = $("#toast"); t.innerHTML = "<span>" + esc(msg) + "</span>";
    if (acao && acao.fn) { var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-sm"; b.textContent = acao.label; b.addEventListener("click", function () { t.classList.remove("show"); acao.fn(); }); t.appendChild(b); }
    t.classList.add("show");
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove("show"); }, acao ? 7000 : 3200);
  }
  var E = null;
  function rawCard(id) { for (var i = 0; i < state.cards.length; i++) if (String(state.cards[i].id) === String(id)) return state.cards[i]; return null; }
  function primeiroNome(n) { var p = String(n).split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1].charAt(0) + "." : p[0]; }
  function prazoTxt(c) {
    var d = c._dias;
    if (d == null) return { t: "sem prazo", cls: "", tip: "Sem data de conclusão no Planner." };
    var full = "Prazo no Planner: " + F.data(c._fatos.prazo);
    if (c.status === "done") return { t: "prazo " + F.data(c._fatos.prazo), cls: "", tip: full };
    if (d < 0) return { t: "venceu há " + (-d) + (d === -1 ? " dia" : " dias"), cls: "bad", tip: full };
    if (d === 0) return { t: "vence hoje", cls: "bad", tip: full };
    return { t: "vence em " + d + (d === 1 ? " dia" : " dias"), cls: d <= 7 ? "warn" : "", tip: full };
  }

  /* ---------------- tooltip ---------------- */
  var tip = null, tipFor = null, pinned = false;
  function showTip(el) {
    var txt = el.getAttribute("data-tip"); if (!txt) return; txt = txt.replace(/\\n/g, "\n");
    tip.textContent = txt; tipFor = el; tip.classList.add("show");
    var r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, vw = window.innerWidth;
    var top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), vw - tw - 8);
    tip.style.top = top + "px"; tip.style.left = left + "px";
  }
  function hideTip() { if (tip) tip.classList.remove("show"); tipFor = null; pinned = false; }
  function bindTips() {
    tip = $("#tip");
    document.addEventListener("mouseover", function (e) { if (pinned) return; var el = e.target.closest && e.target.closest("[data-tip]"); if (el && el !== tipFor) showTip(el); else if (!el && tipFor) hideTip(); });
    document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); else hideTip(); });
    document.addEventListener("focusout", function () { if (!pinned) hideTip(); });
    document.addEventListener("click", function (e) {
      var i = e.target.closest("button.info, .info[tabindex]");
      if (i) { e.preventDefault(); e.stopPropagation(); if (pinned && tipFor === i) return hideTip(); showTip(i); pinned = true; return; }
      if (pinned) hideTip();
    }, true);
    window.addEventListener("scroll", function () { if (tipFor) hideTip(); }, { passive: true });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && tipFor) hideTip(); });
  }

  /* ---------------- seções ---------------- */
  function bindSections() {
    $$(".sec").forEach(function (sec) {
      var id = sec.getAttribute("data-sec"), btn = $(".sec-toggle", sec);
      function set(closed, save) {
        sec.classList.toggle("closed", closed);
        btn.setAttribute("aria-expanded", String(!closed));
        $("span", btn).textContent = closed ? "Expandir" : "Recolher";
        if (save) try { localStorage.setItem("kanzo.sec." + id, closed ? "1" : "0"); } catch (_) {}
      }
      var saved = null; try { saved = localStorage.getItem("kanzo.sec." + id); } catch (_) {}
      set(saved === "1", false);
      btn.addEventListener("click", function () { set(!sec.classList.contains("closed"), true); });
      sec._open = function () { set(false, true); };
    });
    /* Remodelo 11/11: o destaque do menu segue a seção aberta (setVisao), não a rolagem. */
  }

  /* ---------------- cabeçalho ---------------- */
  function setPill(el, cls, txt, tipTxt) {
    el.className = "pill " + cls; $(".t", el).textContent = txt; el.setAttribute("data-tip", tipTxt);
  }
  function renderHeader() {
    var now = Date.now();
    if (state.live) setPill($("#selo"), "live snap", "Ao vivo", "Dados lidos agora do app (Cloudflare), a fonte oficial.\nÚltima leitura: " + F.dataHora(state.loadedAt) + " (Brasília).\nA tela atualiza sozinha a cada 60 s.");
    else setPill($("#selo"), "off snap", "Snapshot", "API indisponível. Mostrando a cópia local " + (state.label || "") + ".\nEdição desligada." + (state.fallbackError ? "\nMotivo: " + state.fallbackError : ""));
    /* Remodelo 11/11: o app é a fonte oficial; o selo do Kanzo do Mac só volta se alguém religar MAC_SYNC no Worker. */
    var sb = $("#sync-badge"); if (sb && state.sync && state.sync.app_only === false) { var rs = F.resumoSync(state.sync, now); setPill(sb, rs.cls, rs.txt, rs.tip); }
    var proj = "Carteira de pré-venda";
    $("#meta-line").textContent = proj + " · " + (state.live ? "lido " + F.relativo(state.loadedAt, now) : "snapshot " + (state.meta.exported_at_brt || ""));
    $("#meta-line").title = "Última leitura: " + F.dataHora(state.loadedAt) + " (Brasília)";
    var adm = $("#btn-admin"); if (adm) adm.hidden = !(state.me && state.me.papel === "admin");
    /* A faixa #write-note só aparece para aviso (API indisponível, só leitura ou erro), não para "edição liberada". */
    var note = $("#write-note"), cw = canWrite();
    note.classList.remove("carregando", "erro", "note-admin");
    if (!state.live) {
      note.hidden = false;
      note.textContent = "API indisponível: mostrando o snapshot local. Edição desligada até a API voltar.";
    } else if (!cw) {
      note.hidden = false;
      note.textContent = "Acesso somente leitura. Pedidos de alteração ao admin (Guilherme).";
    } else {
      note.hidden = true;
      note.textContent = "";
    }
    $$(".needs-live").forEach(function (b) { b.disabled = !cw; });
    $("#btn-new").hidden = !cw && state.live;
    $("#btn-ft").hidden = !cw; $("#save-ind").hidden = !cw;
  }

  /* ---------------- resumo ---------------- */
  function kpi(o) {
    var tag = o.act ? "button" : "article";
    return "<" + tag + (o.act ? ' type="button" data-act="' + esc(o.act) + '"' : ' tabindex="0"') + ' class="kpi ' + (o.cls || "") + '" data-tip="' + esc(o.tip) + '" aria-description="' + esc(o.tip) + '">' +
      '<div class="k-h"><span>' + esc(o.t) + '</span><span class="info" aria-hidden="true">i</span></div>' +
      '<div class="k-v">' + esc(o.v) + "</div>" + '<div class="k-s">' + esc(o.s || "") + "</div>" +
      (o.p != null ? '<div class="k-bar"><i data-p="' + o.p.toFixed(4) + '"></i></div>' : "") + "</" + tag + ">";
  }
  /* Lote 3: resumo da diretoria. TCV ganho separado do TCV em aberto; valor que falta aparece como "sem dado", nunca R$ 0. Sem custo nem margem. */
  function renderKPIs(k) {
    var d = k.diretoria, done = k.byStatus.done || 0, q = k.qualidade;
    var html = [
      d.ganhosComTcv
        ? kpi({ t: "TCV ganho", v: F.brlCurto(d.tcvGanho), cls: "ok", act: "chip:ganhos",
            s: d.ganhos + " ganhos · " + d.ganhosComTcv + " com TCV registrado",
            tip: "Soma do TCV dos cards nas etapas GANHO / Handoff e Entregue / Faturado: " + F.brl(d.tcvGanho) + ".\n" + (d.ganhos - d.ganhosComTcv) + " ganho(s) sem TCV registrado não entram.\nClique para ver os ganhos na carteira." })
        : kpi({ t: "TCV ganho", v: "sem dado", cls: "empty", act: "chip:ganhos", s: d.ganhos + " ganhos, nenhum com TCV registrado",
            tip: "Nenhum card ganho tem linha de tabela com TCV na descrição. Zero seria um dado; aqui o dado falta." }),
      d.abertosComTcv
        ? kpi({ t: "TCV em aberto", v: F.brlCurto(d.tcvAberto), cls: "accent", act: "chip:abertos",
            s: d.abertosComTcv + " de " + d.abertos + " em aberto com TCV",
            tip: "Soma do TCV dos cards abertos (fora de Concluído), sem os ganhos e sem OLD/FALHOU: " + F.brl(d.tcvAberto) + ".\nClique para ver os abertos." })
        : kpi({ t: "TCV em aberto", v: "sem dado", cls: "empty", act: "chip:abertos", s: d.abertos + " em aberto, nenhum com TCV registrado",
            tip: "Nenhum card em aberto tem linha de tabela com TCV na descrição. Por isso não mostramos R$ 0,00." }),
      d.ganhosComMrc
        ? kpi({ t: "MRC ganho / mês", v: F.brlCurto(d.mrcGanho), cls: "", act: "chip:ganhos",
            s: "OTC ganho " + (d.ganhosComOtc ? F.brlCurto(d.otcGanho) : "sem dado"),
            tip: "Receita mensal (MRC) e valor único (OTC) dos ganhos com proposta registrada.\nMRC: " + F.brl(d.mrcGanho) + " em " + d.ganhosComMrc + " card(s).\nOTC: " + (d.ganhosComOtc ? F.brl(d.otcGanho) + " em " + d.ganhosComOtc + " card(s)." : "sem dado.") })
        : kpi({ t: "MRC ganho", v: "sem dado", cls: "empty", s: "nenhum ganho com MRC registrado", tip: "Nenhum card ganho tem linha de MRC na tabela de proposta." }),
      kpi({ t: "Abertos", v: k.abertos, s: "de " + k.total + " ativos · " + done + " concluídos", p: k.total ? k.abertos / k.total : 0, act: "chip:abertos",
        tip: "Cards ativos (não removidos) fora de Concluído.\nOrigem: /api/cards (app).\nClique para filtrar a carteira." }),
      kpi({ t: "Atrasados", v: k.atrasadosAbertos.length, cls: k.atrasadosAbertos.length ? "danger" : "", act: "chip:atrasados",
        s: q.prazoVencido.length + " com data do Planner vencida",
        tip: "Cards abertos cujo prazo efetivo (Prazo Kanzo, senão Planner) já venceu em Brasília.\nA tag “atrasado” do Planner é ignorada.\n" + q.semPrazo.length + " abertos não têm prazo.\nClique para filtrar." }),
      kpi({ t: "Em atenção", v: d.emAtencao.length, cls: d.emAtencao.length ? "warn" : "", act: "saude:atencao",
        s: "abertos com saúde “Atenção”",
        tip: "Cards abertos com “Saúde: Atenção” na descrição (ou tag health:atencao).\n" + (d.emAtencao.slice(0, 8).map(function (c) { return "• " + c.title; }).join("\n") || "Nenhum.") + "\nClique para filtrar a carteira." })
    ].join("");
    $("#kpis").innerHTML = html;
    /* Lote 8: seqüenciado (stagger) da fileira de KPIs na primeira pintura: --i vem de data-i via CSSOM (CSP). */
    $$(".kpi", $("#kpis")).forEach(function (el, i) { el.setAttribute("data-i", String(i)); });
    C.animate($("#kpis"));
  }
  /* Lote 8: abertura (hero) com o TCV ganho levinho de dados vivos (K.compute), nunca número fixo. */
  function compactoD(v) {
    if (!v) return null;
    if (v >= 1e6) return { u: "mi", d: 2 };
    if (v >= 1e3) return { u: "mil", d: 1 };
    return { u: "", d: 2 };
  }
  function heroHTML(v, e) {
    if (!e || !v) return '<span class="h-sd">sem dado</span>';
    var nf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: e.d, maximumFractionDigits: e.d });
    return '<span class="cur">R$</span>' + nf.format(v / (e.u === "mi" ? 1e6 : e.u === "mil" ? 1e3 : 1)) + (e.u ? '<span class="u">' + e.u + "</span>" : "");
  }
  function renderHero(k) {
    var d = k.diretoria;
    var num = $("#hero-num"); if (!num) return;
    var e = compactoD(d.tcvGanho);
    $("#hero-full").textContent = d.tcvGanho ? F.brl(d.tcvGanho) + " em contratos ganhos" : "Nenhum ganho com TCV registrado no app agora.";
    var mrcTxt = d.ganhosComMrc ? F.brlCurto(d.mrcGanho) + "/mês" : "sem dado";
    var otcTxt = d.ganhosComOtc ? F.brlCurto(d.otcGanho) : "sem dado";
    $("#hero-sub").textContent = d.ganhos + " projetos em GANHO / Handoff e Entregue / Faturado, " + d.ganhosComTcv + " com TCV registrado · MRC ganho " + mrcTxt + " · OTC ganho " + otcTxt + ".";
    $("#hero-origem").textContent = "Fonte: cards do app (/api/cards), na hora. Custo e margem não existem aqui.";
    var mz = k.mensal.meses.filter(function (r) { return r.criados || r.concluidos; });
    var periodo = mz.length ? mesTxt(mz[0].mes) + " a " + mesTxt(mz[mz.length - 1].mes) : "sem dado";
    var chips = ["Período Planner: " + periodo, k.total + " cards ativos", "Leitura ao vivo via API" ];
    $("#hero-meta").innerHTML = chips.map(function (c) { return "<li><span class=\"chip\">" + esc(c) + "</span></li>"; }).join("");
    $("#hero-a11y").textContent = "TCV ganho: " + (d.tcvGanho ? F.brl(d.tcvGanho) : "sem dado");
    if (state.heroContou || RM.matches) { num.innerHTML = heroHTML(d.tcvGanho, e); return; }
    state.heroContou = true;
    num.setAttribute("aria-hidden", "true");
    num.innerHTML = heroHTML(d.tcvGanho, e);
    if (state.visao === "resumo") contarHero();
  }
  /* Repaginação clara 13/11: o TCV ganho conta do zero até o valor já calculado (K.compute sobre a API),
     em 8 passos, ~400 ms, cada vez que o Resumo aparece. Só a apresentação muda: o número final é o
     mesmo de heroHTML(d.tcvGanho) e nenhum passo intermediário é gravado (o leitor de tela lê #hero-a11y). */
  var heroVez = 0;
  function contarHero() {
    var num = $("#hero-num"), d = state.k && state.k.diretoria;
    if (!num || !d || !d.tcvGanho || RM.matches) return;
    var e = compactoD(d.tcvGanho), alvo = d.tcvGanho, vez = ++heroVez, t0 = null, dur = 400, passos = 8;
    function passo(t) {
      if (vez !== heroVez) return;
      if (t0 === null) t0 = t;
      var p = Math.min(1, Math.ceil((t - t0) / dur * passos) / passos);
      num.innerHTML = heroHTML(p < 1 ? alvo * p : alvo, e);
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }
  /* Remodelo 11/11: Exige ação = regra antiga (abertos atrasados / a fazer / em andamento, sem OLD/FALHOU)
     + qualquer card ativo com tarefa vencida ou para hoje. Ordem: atrasados, tarefas urgentes, prazo, atualização. */
  function urgTarefas() { return T && state.tasks ? T.urgentes(state.tasks, Date.now()) : {}; }
  function listaAcao(k) {
    var urg = urgTarefas(), vis = {}, out = k.acao.slice();
    out.forEach(function (c) { vis[c.id] = 1; });
    k.list.forEach(function (c) { if (!vis[c.id] && urg[c.id]) { out.push(c); vis[c.id] = 1; } });
    function peso(c) { return c.atrasado && c.status !== "done" ? 0 : urg[c.id] ? 1 : 2; }
    out.sort(function (a, b) {
      var pa = peso(a), pb = peso(b); if (pa !== pb) return pa - pb;
      if (pa === 1) { var ua = urg[a.id][0].p.dias, ub = urg[b.id][0].p.dias; if (ua !== ub) return ua - ub; }
      var da = a._dias == null ? 1e9 : a._dias, db = b._dias == null ? 1e9 : b._dias;
      if (da !== db) return da - db;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    return { lista: out, urg: urg };
  }
  /* Premium 12/11: item da lista Exige ação (e "Ver todos") em cartão com ícones SVG inline e acento por urgência/saúde.
     Só mostra o que existe no card (saúde, responsáveis, próxima ação, TCV); nada é inventado. */
  var AI = {
    etapa: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    todo: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 2.6"/>',
    doing: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
    review: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    outro: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    saude: '<path d="M21 12h-3.5l-2.5 7-5-14-2.5 7H3"/>',
    pessoa: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
    pessoas: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20.5a6.2 6.2 0 0 1 12.4 0"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4"/><path d="M18 14.6a6.2 6.2 0 0 1 3.2 5.9"/>',
    proxima: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h7.5"/><path d="m12.5 8.8 3.2 3.2-3.2 3.2"/>',
    situacao: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    prazo: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    vencido: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9.5 13 5 5M14.5 13l-5 5"/>',
    atualiz: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 8v4.2l2.8 1.7"/>',
    tarefa: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="m8.3 12.3 2.6 2.6 4.9-5.2"/>',
    valor: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    seta: '<path d="m9.5 6 6 6-6 6"/>'
  };
  function ai(n, cls) { return '<svg class="ac-i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + AI[n] + "</svg>"; }
  function tomSaude(s) {
    s = String(s || "");
    if (/risco|cr[ií]tic|vermelh|atras|bloq/i.test(s)) return "bad";
    if (/aten[cç]|amarel|alerta/i.test(s)) return "warn";
    if (/aguard|espera|externo/i.test(s)) return "wait";
    if (/no prazo|ok\b|saud[aá]vel|verde|em dia/i.test(s)) return "ok";
    return "neu";
  }
  function tomPrazo(c) {
    var d = c._dias;
    if (c.status === "done" || d == null) return "neu";
    if (d < 0 || (c.atrasado && c.status !== "done")) return "bad";
    if (d <= 3) return "warn";
    return "ok";
  }
  function cartaoAcao(c, u, now) {
    var f = c._fatos, pz = prazoTxt(c), tp = tomPrazo(c), ts = f.saude ? tomSaude(f.saude) : "neu";
    var acento = tp === "bad" ? "bad" : u ? "tk" : tp === "warn" ? "warn" : f.saude ? ts : tp;
    var st = c.status, stI = AI[st] ? st : "outro";
    var resp = f.responsaveis || [];
    var quem = resp.slice(0, 2).map(primeiroNome).join(", ") + (resp.length > 2 ? " +" + (resp.length - 2) : "");
    var nx = f.proxima ? { r: "Próxima ação", t: f.proxima, i: "proxima" } : f.situacao ? { r: "Situação", t: f.situacao, i: "situacao" } : null;
    var tcv = c._val && c._val.tcv != null ? c._val.tcv : null;
    var aria = c.title + ". " + (c.stage_label || c.stage || "sem etapa") + ", " + F.statusLabel(st) + (f.saude ? ", saúde " + f.saude : "") + ", " + pz.t + ".";
    return '<li><button type="button" class="acard ac-a-' + acento + '" data-act="open:' + esc(c.id) + '" aria-label="' + esc(aria) + '">' +
      '<span class="ac-top"><span class="ac-chips">' +
        '<span class="ac-chip">' + ai("etapa") + "<span>" + esc(c.stage_label || c.stage || "sem etapa") + "</span></span>" +
        '<span class="ac-chip ac-st-' + esc(stI) + '">' + ai(stI) + "<span>" + esc(F.statusLabel(st)) + "</span></span>" +
        (f.saude ? '<span class="ac-chip ac-sd ac-t-' + ts + '">' + ai("saude") + "<span>" + esc(f.saude) + "</span></span>" : "") +
      "</span>" +
      '<span class="ac-pz ac-t-' + tp + '" data-tip="' + esc(pz.tip + "\nAtualizado: " + F.dataHora(c.updated_at)) + '">' + ai(tp === "bad" ? "vencido" : "prazo") + "<span>" + esc(pz.t) + "</span></span></span>" +
      '<span class="ac-title">' + esc(c.title) + "</span>" +
      (u ? '<span class="ac-tk">' + ai("tarefa") + '<span class="ac-tk-t"><b>' + esc(u[0].p.dias < 0 ? "Tarefa vencida" : "Tarefa de hoje") + "</b> " + esc(u[0].t.title + " · " + u[0].p.t + (u.length > 1 ? " (+" + (u.length - 1) + ")" : "")) + "</span></span>" : "") +
      (nx ? '<span class="ac-nx">' + '<span class="ac-nx-h">' + ai(nx.i) + esc(nx.r) + "</span>" + '<span class="ac-nx-t">' + esc(nx.t) + "</span></span>" : "") +
      '<span class="ac-ft">' +
        (quem ? '<span class="ac-meta">' + ai(resp.length > 1 ? "pessoas" : "pessoa") + "<span>" + esc(quem) + "</span></span>" : "") +
        '<span class="ac-meta">' + ai("atualiz") + "<span>" + esc("atualiz. " + F.relativo(c.updated_at, now)) + "</span></span>" +
        (tcv != null ? '<span class="ac-meta ac-val">' + ai("valor") + "<span>TCV " + esc(F.brlCurto(tcv)) + "</span></span>" : "") +
        ai("seta", "ac-go") +
      "</span></button></li>";
  }
  function renderAcao(k) {
    var la = listaAcao(k), all = la.lista, urg = la.urg, lim = state.acaoAll ? all.length : (MOBILE.matches ? 4 : 6), now = Date.now();
    var nUrg = Object.keys(urg).length;
    $("#acao-meta").textContent = all.length + " projetos" + (nUrg ? " · " + nUrg + " com tarefa vencida ou de hoje" : "");
    $("#nav-acao").hidden = !all.length; $("#nav-acao").textContent = all.length;
    $("#acao-list").innerHTML = all.slice(0, lim).map(function (c) {
      return cartaoAcao(c, urg[c.id], now);
    }).join("") || '<li class="empty"><svg class="ico" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg><span><b>Nada pendente</b>Nenhum card aberto atrasado, a fazer ou em andamento, nem tarefa vencida.</span></li>';
    var more = $("#acao-mais");
    more.hidden = all.length <= lim && !state.acaoAll;
    more.textContent = state.acaoAll ? "Mostrar só os primeiros" : "Ver todos (" + all.length + ")";
  }
  function renderValor(k) {
    var box = $("#ganhos-list"), cs = k.comValor;
    var ganhosSem = k.ganhos.filter(function (c) { return c._val.tcv == null; });
    $("#valor-meta").textContent = cs.length ? cs.length + " projetos" : "";
    if (!cs.length) {
      box.innerHTML = '<div class="empty"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span><b>Nenhuma proposta com valor nos cards</b>Para aparecer aqui, a descrição do card precisa de uma linha de tabela como <code>| TCV (12m) | R$ 69.033,32 |</code>. ' +
        (k.ganhos.length ? k.ganhos.length + " ganhos estão sem esse valor." : "") + "</span></div>";
      return;
    }
    var max = cs[0]._val.tcv || 1;
    box.innerHTML = '<div class="vtotal"><b>' + esc(F.brl(k.tcvSoma)) + "</b><span>TCV somado · MRC " + esc(F.brlCurto(k.mrcSoma)) + "/mês</span></div>" +
      '<ul class="vlist">' + cs.slice(0, 6).map(function (c) {
        var v = c._val, o = "TCV " + F.brl(v.tcv) + "\nFonte: " + (v.fonte.tcv || "") + (v.origem.tcv ? "\nLinha: " + v.origem.tcv : "") +
          (v.mrc != null ? "\nMRC " + F.brl(v.mrc) : "") + (v.otc != null ? "\nOTC " + F.brl(v.otc) : "") + (v.prazo_meses ? "\nPrazo " + v.prazo_meses + " meses" : "");
        return '<li><button type="button" class="vrow" data-act="open:' + esc(c.id) + '" data-tip="' + esc(o) + '"><span class="u-minw0"><div class="v-t">' + esc(c.title) + '</div><div class="v-s">' +
          esc((c.stage_label || c.stage || "") + (v.mrc != null ? " · MRC " + F.brlCurto(v.mrc) + "/mês" : "")) + '</div><div class="vbar"><i data-p="' + (v.tcv / max).toFixed(4) + '"></i></div></span><span class="v-v">' + esc(F.brlCurto(v.tcv)) + "</span></button></li>";
      }).join("") + "</ul>" +
      (ganhosSem.length ? '<p class="v-s u-note-warn" data-tip="' + esc(ganhosSem.map(function (c) { return c.title; }).join("\n")) + '">' + ganhosSem.length + " ganho(s) sem TCV registrado</p>" : "");
    C.animate(box);
  }

  /* ---------------- funil e status ---------------- */
  function renderFunil(kAll) {
    var fl = state.filter, k = kDe("stage");
    C.hbars($("#funnel"), k.funil.map(function (f) {
      return { label: f.label, value: f.count, late: f.atrasados, action: f.key ? "f:stage:" + f.key : "", sel: !!f.key && fl.stage === f.key,
        tip: f.label + "\n" + f.count + " cards · " + f.abertos + " abertos · " + f.atrasados + " atrasados\nClique para filtrar os outros gráficos e a carteira." };
    }), { total: k.total, titulo: "Funil por etapa", colunas: ["Etapa", "Cards", "Atrasados"], empty: '<div class="empty">Sem etapas no quadro.</div>' });
    var temTcv = k.funil.some(function (f) { return f.comTcv; });
    C.hbars($("#funnel-tcv"), temTcv ? k.funil.filter(function (f) { return f.count; }).map(function (f) {
      return { label: f.label, value: f.tcv, display: f.comTcv ? F.brlCurto(f.tcv) : "sem dado", sub: f.count + " cards", action: f.key ? "f:stage:" + f.key : "", sel: !!f.key && fl.stage === f.key,
        tip: f.label + "\nTCV " + (f.comTcv ? F.brl(f.tcv) + " em " + f.comTcv + " de " + f.count + " cards" : "sem dado (nenhum dos " + f.count + " cards tem TCV)") + "\nClique para filtrar." };
    }) : [], { pct: false, titulo: "TCV por etapa", colunas: ["Etapa", "TCV", "Cards"],
      empty: '<div class="empty"><span><b>Sem TCV registrado nestes cards</b>O valor só entra com linha de tabela de proposta (TCV) na descrição.</span></div>' });
    k = kDe("status");
    var parts = ["todo", "doing", "review", "backlog", "done"].filter(function (s) { return k.byStatus[s]; })
      .map(function (s) { return { key: s, label: F.statusLabel(s), value: k.byStatus[s], color: STATUS_COR[s] }; });
    Object.keys(k.byStatus).forEach(function (s) { if (!STATUS_COR[s]) parts.push({ key: s, label: F.statusLabel(s), value: k.byStatus[s], color: "var(--c5)" }); });
    var css = getComputedStyle(document.documentElement);
    C.donut($("#donut"), parts.map(function (p) { return Object.assign({}, p, { color: p.color.replace(/var\((--[\w-]+)\)/, function (_, v) { return css.getPropertyValue(v).trim(); }) }); }));
    $("#donut-legend").innerHTML = parts.map(function (p) {
      return '<li><button type="button" class="' + (fl.status === p.key ? "sel" : "") + '" aria-pressed="' + (fl.status === p.key) + '" data-act="f:status:' + esc(p.key) + '" data-tip="' + esc(p.label + ": " + p.value + " cards\nClique para filtrar os outros gráficos e a carteira.") + '"><span class="sw" data-bg="' + esc(p.color) + '"></span><span class="lb">' + esc(p.label) +
        '</span><span class="ct">' + p.value + '</span><span class="pc">' + Math.round(p.value / (k.total || 1) * 100) + "%</span></button></li>";
    }).join("");
    k = kDe("fam");
    var semSol = k.qualidade.semSolucao.length;
    $("#sol-meta").textContent = (k.total - semSol) + " com solução · " + semSol + " a definir";
    C.hbars($("#sol-bars"), k.familias.map(function (f) {
      return { label: f.label, value: f.cards.length, action: "f:fam:" + f.label, sel: fl.fam === f.label,
        tip: f.label + " · " + f.cards.length + " projetos\n" + f.cards.slice(0, 8).map(function (c) { return "• " + c.title; }).join("\n") + (f.cards.length > 8 ? "\n+ " + (f.cards.length - 8) + " outros" : "") };
    }), { pct: false, titulo: "Soluções por família", colunas: ["Família", "Projetos"], empty: '<div class="empty"><span><b>Nenhum card com solução definida</b>Todos estão como “A definir”. Veja Qualidade dos dados.</span></div>' });
    /* Lote 8: TCV por solução vira anel desenhável (legenda filtra por família); famílias sem
       TCV não pintam fatia (não é "R$ 0", é ausência de dado registrado). */
    var famTcv = k.familias.filter(function (f) { return f.comTcv; });
    var PAL = ["--c1", "--c2", "--c3", "--c4", "--c6", "--c7", "--c8", "--c5"];
    C.anel($("#sol-tcv"), famTcv.map(function (f, i) {
      return { label: f.label, value: f.tcv, color: "var(" + PAL[i % PAL.length] + ")", action: "f:fam:" + f.label, sel: fl.fam === f.label,
        tip: f.label + "\nTCV " + F.brl(f.tcv) + " em " + f.comTcv + " de " + f.cards.length + " projetos\nClique para filtrar." };
    }), { titulo: "TCV por solução", colunas: ["Família", "TCV"], centro: famTcv.length ? F.brlCurto(famTcv.reduce(function (s, f) { return s + f.tcv; }, 0)) : "", centroSub: "TCV ganho por solução",
      empty: '<div class="empty"><span><b>Sem TCV registrado por solução</b>Nenhum card desta seleção tem TCV na descrição.</span></div>' });
    k = kDe("resp");
    C.hbars($("#resp-bars"), k.responsaveis.map(function (r) {
      var late = r.cards.filter(function (c) { return c.atrasado; }).length;
      return { label: r.label, value: r.cards.length, late: late, action: "f:resp:" + r.label, sel: fl.resp === r.label,
        tip: r.label + "\n" + r.cards.length + " abertos · " + late + " atrasados\nClique para filtrar os outros gráficos e a carteira." };
    }), { pct: false, titulo: "Carga por responsável (abertos)", colunas: ["Responsável", "Abertos", "Atrasados"], empty: '<div class="empty"><span><b>Sem responsáveis nos cards</b>O campo “Responsáveis” não aparece nas descrições.</span></div>' });
  }

  /* ---------------- carteira ---------------- */
  var CHIPS = [
    { id: "abertos", t: "Abertos", f: function (c) { return c.status !== "done"; } },
    { id: "atrasados", t: "Atrasados", f: function (c) { return c.atrasado && c.status !== "done"; } },
    { id: "prazo", t: "Prazo vencido", f: function (c) { return c.status !== "done" && c.stage !== "old-falhou" && c._dias != null && c._dias < 0; } },
    { id: "tarefas", t: "Tarefa vencida ou de hoje", f: function (c) { return !!urgTarefas()[c.id]; } },
    { id: "valor", t: "Com valor", f: function (c) { return c._val.tcv != null; } },
    { id: "ganhos", t: "Ganhos", f: function (c) { return !!K.GANHO[c.stage]; } },
    { id: "semsol", t: "Solução a definir", f: function (c) { return K.semSolucao(c); } },
    { id: "concluidos", t: "Concluídos", f: function (c) { return c.status === "done"; } },
    { id: "todos", t: "Todos", f: function () { return true; } }
  ];
  function famRe(label) { var f = K.FAMILIAS.filter(function (x) { return x.label === label; })[0]; return f && f.re; }
  function visibleCards() {
    var fl = state.filter, list = state.k ? state.k.list : [];
    var chip = CHIPS.filter(function (c) { return c.id === fl.chip; })[0] || CHIPS[CHIPS.length - 1];
    list = list.filter(chip.f);
    if (fl.q) { var q = fl.q.toLowerCase(); list = list.filter(function (c) { return (c.title + " " + c.solution + " " + (c.description || "")).toLowerCase().indexOf(q) >= 0; }); }
    list = list.filter(function (c) { return passa(c, fl, ""); });
    var by = {
      acao: function (a, b) { var r = (b.status !== "done") - (a.status !== "done"); if (r) return r;
        r = (a.stage === "old-falhou") - (b.stage === "old-falhou"); if (r) return r; r = !!b.atrasado - !!a.atrasado; if (r) return r;
        var da = a._dias == null ? 1e9 : a._dias, db = b._dias == null ? 1e9 : b._dias; return da - db || String(b.updated_at).localeCompare(String(a.updated_at)); },
      recente: function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); },
      prazo: function (a, b) { return (a._dias == null ? 1e9 : a._dias) - (b._dias == null ? 1e9 : b._dias); },
      valor: function (a, b) { return (b._val.tcv || -1) - (a._val.tcv || -1); },
      titulo: function (a, b) { return String(a.title).localeCompare(String(b.title), "pt-BR"); }
    };
    return list.slice().sort(by[fl.sort] || by.acao);
  }
  function renderChips() {
    var list = state.k ? state.k.list : [], fl = state.filter;
    var extra = "";
    $("#chips").innerHTML = CHIPS.map(function (c) {
      return '<button class="chip" type="button" aria-pressed="' + (fl.chip === c.id) + '" data-act="chip:' + c.id + '">' + esc(c.t) + ' <span class="c">' + list.filter(c.f).length + "</span></button>";
    }).join("") + extra;
    var ativo = fl.q || fl.stage || fl.status || fl.fam || fl.resp || fl.saude || fl.periodo || fl.prazo || fl.chip !== "abertos" || fl.sort !== "acao";
    $("#f-limpar").hidden = !ativo;
  }
  var DOT_TIP = { saving: "Salvando suas alterações", saved: "Salvo no app.", applied: "Confirmado no app", error: "Uma alteração precisa de você (erro ou conflito). Abra o projeto." };
  function saveDot(c) {
    var st = E ? E.estado(c.id) : "";
    if (!st && c.pending) st = "saved";
    return st ? ' <span class="sdot ' + st + '" role="img" aria-label="' + esc(DOT_TIP[st]) + '" data-tip="' + esc(DOT_TIP[st]) + '"></span>' : "";
  }
  function avisoTag(c) {
    var a = F.avisoCard(c); if (!a) return "";
    return ' <span class="tag bad sync-tag" role="img" aria-label="' + esc(a.motivo) + '" data-tip="' + esc(a.tip) + '">' + esc(a.curto) + "</span>";
  }
  /* Remodelo 11/11: selo de tarefas no card (abertas; vermelho de marca se alguma venceu ou é para hoje). */
  function tagTarefas(c, urg) {
    if (!state.tasks) return "";
    var ab = tarefasDoCard(c.id).filter(function (t) { return !t.done && !t.dismissed; }).length;
    if (!ab) return "";
    var u = urg[c.id];
    return '<span class="tag ' + (u ? "tk-urg" : "dim") + '" title="' + esc(u ? u[0].t.title + " · " + u[0].p.t : ab + " tarefa(s) aberta(s)") + '">' + ab + (ab === 1 ? " tarefa" : " tarefas") + (u ? " · " + (u[0].p.dias < 0 ? "vencida" : "hoje") : "") + "</span>";
  }
  /* 18/11: ícone de documento com a contagem de links do card (lista e funil); só isso, nada mais muda no card da lista. */
  function tagDocs(c) {
    var n = state.docCounts && state.docCounts[c.id]; if (!n) return "";
    return '<span class="dc-ct" title="' + n + (n === 1 ? " documento/link neste projeto" : " documentos/links neste projeto") + '"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><b>' + n + '</b><span class="sr-only">' + (n === 1 ? " documento" : " documentos") + "</span></span>";
  }
  /* Sugestões da busca (datalist nativo): só títulos de cards já visíveis ao usuário; a busca em si não muda. */
  function atualizarSugestoes() {
    var dl = $("#iniciativas-dl"); if (!dl || !state.k) return;
    var visto = {}, html = "";
    state.k.list.forEach(function (c) {
      var t = c.title; if (!t || visto[t] || Object.keys(visto).length >= 200) return;
      visto[t] = 1; html += '<option value="' + esc(t) + '"' + (!K.semSolucao(c) && c.solution ? ' label="' + esc(c.solution) + '"' : "") + ">";
    });
    dl.innerHTML = html;
  }
  function renderList() {
    atualizarSugestoes();
    renderChips();
    var list = visibleCards(), total = state.k ? state.k.total : 0, now = Date.now(), lim = state.filter.limit;
    $("#count-view").textContent = list.length + " de " + total;
    var nc = $("#nav-carteira"); if (nc) { nc.hidden = false; nc.textContent = list.length; }
    var head = '<div class="prow head" aria-hidden="true"><span>Projeto</span><span>Etapa</span><span>Status</span><span class="u-right">Valor (TCV)</span><span class="u-right">Prazo</span><span></span></div>';
    var urgL = urgTarefas();
    $("#card-list").innerHTML = list.length ? head + list.slice(0, lim).map(function (c) {
      var v = c._val, pz = prazoTxt(c), f = c._fatos;
      var sub = [K.semSolucao(c) ? "Solução a definir" : c.solution].concat(f.responsaveis.length ? [f.responsaveis.map(primeiroNome).join(", ")] : []).join(" · ");
      var st = c.atrasado && c.status !== "done" ? '<span class="tag bad">atrasado</span>' : '<span class="tag ' + (c.status === "done" ? "ok" : c.status === "doing" ? "acc" : c.status === "todo" ? "warn" : "") + '">' + esc(F.statusLabel(c.status)) + "</span>";
      return '<button type="button" class="prow" data-act="open:' + esc(c.id) + '" data-id="' + esc(c.id) + '">' +
        '<span class="p-main u-minw0"><div class="p-t">' + esc(c.title) + saveDot(c) + avisoTag(c) + '</div><div class="p-s">' + esc(sub) + "</div>" + (tagTarefas(c, urgL) || tagDocs(c) ? '<div class="p-tk">' + tagTarefas(c, urgL) + tagDocs(c) + "</div>" : "") + "</span>" +
        '<span class="p-e">' + esc(c.stage_label || c.stage || "sem etapa") + "</span>" +
        '<span class="p-st">' + st + "</span>" +
        (v.tcv != null ? '<span class="p-v" data-tip="' + esc((v.fonte.tcv || "") + (v.origem.tcv ? "\n" + v.origem.tcv : "")) + '">' + esc(F.brlCurto(v.tcv)) + "</span>" : '<span class="p-v none">sem valor</span>') +
        '<span class="p-d ' + pz.cls + '" data-tip="' + esc(pz.tip + "\nAtualizado " + F.relativo(c.updated_at, now) + " (" + F.dataHora(c.updated_at) + ")") + '">' + esc(pz.t) + "</span>" +
        '<svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button>';
    }).join("") : '<div class="empty u-m12"><span><b>Nenhum projeto neste filtro</b>Troque o filtro rápido ou limpe a busca.</span></div>';
    var more = $("#list-more");
    more.hidden = list.length <= lim;
    more.textContent = "Mostrar mais " + Math.min(25, list.length - lim) + " (" + (list.length - lim) + " restantes)";
  }

  /* ---------------- qualidade ---------------- */
  function renderQualidade(k) {
    var q = k.qualidade, cw = canWrite(), total = k.total || 1;
    var itens = [
      { id: "solucao", t: "Solução a definir", d: "Escopo não identificado no card", l: q.semSolucao },
      { id: "valor", t: "Sem valor registrado", d: "Abertos ou ganhos sem TCV", l: q.semValor },
      { id: "prazo", t: "Abertos sem prazo", d: "Sem data de conclusão", l: q.semPrazo },
      { id: "responsavel", t: "Sem responsável", d: "Ninguém em Responsáveis", l: q.semResponsavel }
    ];
    var faltando = {}; itens.forEach(function (it) { it.l.forEach(function (c) { faltando[c.id] = 1; }); });
    var nFalt = Object.keys(faltando).length;
    $("#nav-qual").hidden = !nFalt; $("#nav-qual").textContent = nFalt;
    var ftb = $("#btn-ft-n"); if (ftb) { ftb.textContent = nFalt; ftb.hidden = !nFalt; }
    var hero = '<div class="qhero"><div class="qh-t"><b>' + (nFalt ? nFalt + " projetos com algo faltando" : "Carteira completa") + "</b><span>" +
      (nFalt ? "Na força-tarefa você preenche em sequência, com o campo que falta já aberto, ou em lote. Salva sozinho." : "Nenhum dos quatro indicadores tem pendência.") + "</span></div>" +
      (cw ? '<button type="button" class="btn btn-primary" data-ft="todos"' + (nFalt ? "" : " disabled") + '><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Iniciar força-tarefa <kbd>F</kbd></button>'
        : '<span class="tag dim" data-tip="Edição só para o admin, com a API no ar.">somente leitura</span>') + "</div>";
    var cards = '<div class="qcards">' + itens.map(function (it) {
      var n = it.l.length, tag = cw ? "button" : "div";
      return "<" + tag + (cw ? ' type="button" data-ft="' + it.id + '"' : "") + ' class="qcard q-' + it.id + (n ? "" : " zero") + '" data-tip="' + esc(it.t + ": " + n + " projetos\n" + it.l.slice(0, 8).map(function (c) { return "• " + c.title; }).join("\n") + (n > 8 ? "\n+ " + (n - 8) + " outros" : "") + (cw && n ? "\nClique para resolver na força-tarefa." : "")) + '">' +
        '<span class="qc-n">' + n + '</span><span class="qc-t">' + esc(it.t) + '</span><span class="qc-d">' + esc(it.d) + '</span><span class="qc-bar"><i data-sx="' + (n / total).toFixed(3) + '"></i></span>' +
        (cw ? '<span class="qc-go">' + (n ? "Resolver" : "Tudo certo") + (n ? ' <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' : "") + "</span>" : "") + "</" + tag + ">";
    }).join("") + "</div>";
    var outros = [
      { t: "Prazo vencido", d: "Abertos com data de conclusão passada", l: q.prazoVencido, cls: "bad" },
      { t: "Abertos em OLD/FALHOU", d: "Projeto perdido, mas o card não está concluído", l: q.perdidoAberto, cls: "warn" },
      { t: "Aguardando o Mac", d: "Gravado na nuvem, o Kanzo ainda vai aplicar", l: q.pendentes, cls: "warn", soMac: true }
    ].filter(function (it) { return !it.soMac || (state.sync && state.sync.app_only === false); });
    $("#qual-grid").innerHTML = hero + cards + '<div class="grid g-q">' + outros.map(function (it) {
      var n = it.l.length;
      return '<details class="q"><summary><span><div class="q-t">' + esc(it.t) + '</div><div class="q-d">' + esc(it.d) + '</div></span><span class="q-n ' + (n ? it.cls : "ok") + '">' + n + '</span><svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></summary>' +
        (n ? "<ul>" + it.l.map(function (c) { return '<li><button type="button" data-act="open:' + esc(c.id) + '" title="' + esc(c.title) + '">' + esc(c.title) + "</button></li>"; }).join("") + "</ul>" : '<ul><li class="okline">Tudo certo aqui.</li></ul>') + "</details>";
    }).join("") +
      '<details class="q u-col-full"><summary><span><div class="q-t">Como cada número é calculado</div><div class="q-d">Regras usadas no painel, para conferência</div></span><span></span><svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></summary><div class="reqs u-reqs"><ol>' +
      "<li><b>Abertos:</b> cards ativos fora de Concluído.</li>" +
      "<li><b>Atrasados:</b> abertos com prazo efetivo vencido (Prazo Kanzo, senão data de conclusão do Planner), em America/Sao_Paulo. A tag “atrasado” do Planner não manda.</li>" +
      "<li><b>Prazo:</b> “Prazo (Kanzo)” quando foi definido no app; senão a “Data de conclusão” das Datas Planner. As Datas Planner nunca são apagadas.</li>" +
      "<li><b>Valor (TCV, MRC, OTC):</b> só linhas de tabela com rótulo explícito na descrição (proposta ou bloco “Valores (Kanzo)” gravado pelo painel). Estimativas em texto não entram.</li>" +
      "<li><b>Responsáveis:</b> linha “Responsáveis” da descrição. O autocompletar só sugere pessoas que já aparecem nos cards.</li>" +
      "<li><b>Famílias de solução:</b> palavra-chave no escopo do card; um projeto pode contar em mais de uma família.</li>" +
      "<li><b>Exige ação:</b> abertos atrasados, a fazer ou em andamento, sem os cards da etapa OLD/FALHOU (projeto perdido), mais qualquer card com tarefa vencida ou para hoje.</li>" +
      "<li><b>Probabilidades do pipeline:</b> exemplo, não oficiais.</li></ol></div></details></div>";
  }

  /* ---------------- drawer ---------------- */
  function fact(label, val, tipTxt, wide) {
    return '<div class="fact' + (wide ? " wide" : "") + '"><small>' + esc(label) + (tipTxt ? ' <span class="info" tabindex="0" role="img" aria-label="' + esc(tipTxt) + '" data-tip="' + esc(tipTxt) + '">i</span>' : "") + "</small><div" + (val ? "" : ' class="none"') + ">" + esc(val || "sem dado") + "</div></div>";
  }
  function openDrawer(id, opener) {
    var c = state.k && state.k.list.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    if (String(selectedId) !== String(c.id)) state.tkEdit = null;
    selectedId = c.id; lastOpener = opener || document.activeElement;
    $("#drawer-bg").classList.add("open"); var d = $("#drawer"); d.classList.add("open"); d.setAttribute("aria-hidden", "false");
    renderDrawer(c);
    if (state.live && docsCtl) docsCtl.carregar(c.id);
    setTimeout(function () { $("#drawer-close").focus(); }, 30);
    if (state.live) KanzoData.tryFetch("/api/cards/" + encodeURIComponent(c.id)).then(function (full) {
      if (!full || String(selectedId) !== String(c.id)) return;
      var box = $("#d-comments"); if (box) box.outerHTML = commentsHtml(full.comments || []);
    }).catch(function () { var box = $("#d-comments"); if (box) $(".cm-body", box).innerHTML = '<div class="empty">Não foi possível carregar os comentários.</div>'; });
  }
  function commentsHtml(list, loading) {
    return '<details class="blk" id="d-comments" open><summary>Comentários<span class="meta">' + (loading ? "carregando…" : list.length) + '</span></summary><div class="cm-body">' +
      (loading ? '<div class="cmt"><small>Buscando comentários…</small></div>' : list.length ? list.map(function (cm) {
        return '<div class="cmt"><small>' + esc((cm.author ? cm.author + " · " : "") + F.dataHora(cm.created_at)) + "</small><p>" + esc(cm.body) + "</p></div>";
      }).join("") : '<div class="cmt"><small>Sem comentários.</small></div>') + "</div></details>";
  }
  /* Remodelo 11/11: card na ordem da decisão. 1) etapa, status, saúde e prazo; 2) situação atual e próxima ação; 3) tarefas;
     4) responsáveis e solução; 5) valores (destaque só com valor; vazio fica recolhido); 6) histórico, mais campos e comentários. */
  function tarefasDoCard(id) { return T && state.tasks ? T.doCard(state.tasks, id) : []; }
  function tarefasHtml(c) {
    if (!T) return "";
    return T.blocoHtml(c, tarefasDoCard(c.id), { cw: canWrite(), agora: Date.now(), editId: state.tkEdit, carregando: state.live && state.tasks == null && !state.tasksErro,
      erro: state.tasksErro || "", stageLabel: c.stage_label || stageLabel(c.stage) });
  }
  function refreshTarefasDrawer() {
    if (selectedId == null) return;
    var c = state.k && state.k.list.filter(function (x) { return String(x.id) === String(selectedId); })[0], box = $("#d-tasks");
    if (!c || !box) return;
    var foco = document.activeElement && box.contains(document.activeElement) ? (document.activeElement.closest("[data-tk],[data-sg],[data-tk-form]") || {}) : null;
    var chave = foco && foco.getAttribute ? (foco.getAttribute("data-tk") ? '[data-tk="' + foco.getAttribute("data-tk") + '"]' : foco.getAttribute("data-tk-form") === "nova" ? '[data-tk-form="nova"]' : null) : null;
    box.outerHTML = tarefasHtml(c);
    if (chave) { var alvo = $("#d-tasks " + chave + " button, #d-tasks " + chave + " input"); if (alvo) alvo.focus(); }
  }
  /* Repaginação 12/11: cabeçalho com ícone (SVG inline, traço Lucide) em cada bloco do card. */
  var IC_BLK = { dec: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>', foco: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5"/>',
    resp: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    val: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' };
  function blkH(ic, titulo, meta) { return '<div class="dblk-h"><h3><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + IC_BLK[ic] + "</svg>" + esc(titulo) + "</h3>" + (meta ? '<span class="meta">' + esc(meta) + "</span>" : "") + "</div>"; }
  function decItem(rot, corpo) { return '<div class="dec-i"><span class="dec-l">' + esc(rot) + "</span>" + corpo + "</div>"; }
  function renderDrawer(c) {
    var cw = canWrite(), f = c._fatos, r = rawCard(c.id) || c;
    $("#drawer-title").textContent = c.title;
    /* Item 4: rascunhos só para admin com API ao vivo (a rota também barra leitura). */
    var docs = $("#drawer-docs"), adm = state.live && state.me && state.me.papel === "admin";
    docs.hidden = !adm;
    if (adm) { var base = "/api/cards/" + encodeURIComponent(c.id) + "/rascunho?tipo=";
      $("#doc-pricing").href = base + "pricing"; $("#doc-pricing-md").href = base + "pricing&formato=md";
      $("#doc-proposta").href = base + "proposta"; $("#doc-proposta-md").href = base + "proposta&formato=md"; }
    $("#drawer-tags").innerHTML = (c.atrasado && c.status !== "done" ? '<span class="tag bad">atrasado</span>' : "") + avisoTag(c) +
      (c.priority ? '<span class="tag dim">prioridade ' + esc(c.priority_label || c.priority) + "</span>" : "") + (K.semSolucao(c) ? "" : '<span class="tag dim">' + esc(c.solution) + "</span>");
    var outros = f.lista.filter(function (x) { return !/^(Respons|Sa[uú]de|Situa|Pr[oó]xima|Solu|Prazo \(Kanzo\)|Valores \(Kanzo\))/i.test(x.rotulo); });
    var stOpts = ["todo", "doing", "done", "review", "backlog"];
    if (stOpts.indexOf(c.status) < 0) stOpts.push(c.status);
    var av = F.avisoCard(c);
    var etapa = cw ? '<label class="dec-sel"><span class="sr-only">Etapa</span><select class="sel" id="d-stage">' + optsEtapa(c.stage) + (c.stage && !(state.stages || []).some(function (s) { return s.key === c.stage; }) ? '<option value="' + esc(c.stage) + '" selected>' + esc(c.stage) + "</option>" : "") + "</select></label>"
      : '<b class="dec-v">' + esc(c.stage_label || c.stage || "sem etapa") + "</b>";
    var status = cw ? '<label class="dec-sel"><span class="sr-only">Status</span><select class="sel" id="d-status">' + stOpts.map(function (s) { return '<option value="' + esc(s) + '"' + (c.status === s ? " selected" : "") + ">" + esc(F.statusLabel(s)) + "</option>"; }).join("") + "</select></label>"
      : '<b class="dec-v">' + esc(F.statusLabel(c.status)) + "</b>";
    var html = (av ? '<div class="sync-warn" role="alert"><b>' + esc(av.motivo) + "</b><span>" + esc(av.tip.split("\n").slice(1).join(" ")) + "</span></div>" : "") +
      '<section class="dblk dec" aria-label="Decisão: etapa, status, saúde e prazo">' + blkH("dec", "Onde está o projeto") + '<div class="dec-g">' + decItem("Etapa", etapa) + decItem("Status", status) + "</div>" +
      '<div class="efs">' + E.fieldHtml(r, "saude") + E.fieldHtml(r, "prazo") + "</div></section>";
    /* Situação atual: se o campo está vazio mas a descrição tem texto narrativo, mostra (sem gravar) e oferece salvar no campo certo. */
    var nar = !f.situacao && T ? T.narrativa(c.description) : "";
    html += '<section class="dblk foco" aria-label="Situação atual e próxima ação">' + blkH("foco", "Situação e próxima ação") + '<div class="efs">' + E.fieldHtml(r, "situacao", { wide: true }) +
      (nar ? '<div class="sit-fb" id="sit-fb"><b>Texto do card fora do campo “Situação atual”</b><p>' + esc(nar) + "</p>" +
        (cw ? '<div class="tk-row"><button type="button" class="btn btn-sm" data-usar-sit="1">Usar como situação atual</button><span class="hint">Confira e ajuste depois; só grava quando você toca no botão.</span></div>' : "") + "</div>" : "") +
      E.fieldHtml(r, "proxima", { wide: true }) + "</div></section>";
    html += tarefasHtml(c) + (state.live && docsCtl ? docsCtl.html() : "");
    html += '<section class="dblk" aria-label="Responsáveis e solução">' + blkH("resp", "Responsáveis e solução") + '<div class="efs">' + E.fieldHtml(r, "responsaveis", { wide: true }) + E.fieldHtml(r, "solucao", { wide: true }) + "</div></section>";
    var v = c._val || {}, temValor = v.tcv != null || v.mrc != null || v.otc != null;
    var importa = !!K.GANHO[c.stage] || (c.status !== "done" && c.stage !== "old-falhou");
    var campos = '<div class="efs efs-3">' + ["tcv", "mrc", "otc"].map(function (k) { return E.fieldHtml(r, k); }).join("") + "</div>";
    html += temValor ? '<section class="dblk" aria-label="Valores">' + blkH("val", "Valores", "preço ao cliente") + campos + "</section>"
      : '<details class="blk d-val"><summary>Valores (TCV, MRC, OTC)<span class="meta' + (importa ? " warn" : "") + '">' + (importa ? "ainda sem valor · registre quando houver proposta" : "sem valor registrado") + "</span></summary><div>" + campos + "</div></details>";
    html += '<div class="d-meta"><span>Atualizado ' + esc(F.relativo(c.updated_at) + " · " + F.dataHora(c.updated_at)) + "</span><span>Criado " + esc(F.dataHora(c.created_at)) + "</span></div>";
    if (outros.length) html += '<details class="blk"><summary>Dados do Planner<span class="meta">' + outros.length + " campos · histórico, só leitura</span></summary><div><div class=\"facts\">" + outros.map(function (x) { return fact(x.rotulo, x.valor, "", true); }).join("") + "</div></div></details>";
    html += '<details class="blk" id="d-hist"><summary>Histórico do card<span class="meta">quem mudou o quê</span></summary><div class="hist-body"><div class="cmt"><small>Abra para carregar.</small></div></div></details>';
    if (cw) {
      var trava = E.temPendente(c.id);
      html += '<details class="blk"><summary>Mais campos<span class="meta">título, comentário, descrição</span></summary><div class="form-d">' +
        '<div class="fld"><label for="f-title">Título</label><input class="inp" id="f-title" value="' + esc(c.title) + '" /></div>' +
        '<div class="fld"><label for="f-comment">Novo comentário</label><textarea class="u-minh70" id="f-comment" placeholder="Escreva e toque em Salvar"></textarea></div>' +
        '<details class="adv"><summary>Descrição completa (avançado)</summary><div class="fld"><label for="f-desc">Descrição</label><textarea id="f-desc"' + (trava ? " disabled" : "") + ">" + esc(r.description || "") + "</textarea>" +
        '<span class="hint">' + (trava ? "Bloqueada enquanto há edição de campo sendo gravada, para uma não apagar a outra." : "Prefira os campos acima. Aqui você edita o texto bruto do card.") + "</span></div></details></div></details>";
    } else {
      html += '<details class="blk"><summary>Descrição completa<span class="meta">' + ((c.description || "").length ? Math.ceil((c.description || "").length / 1000) + " mil caracteres" : "vazia") + '</span></summary><div><div class="desc">' + esc(c.description || c.summary || "Sem descrição.") + "</div></div></details>";
    }
    html += commentsHtml(c.comments || [], state.live);
    $("#drawer-body").innerHTML = html;
    descDrawerInicial = r.description || "";
    if (state.live && docsCtl) docsCtl.ligar();
    $("#drawer-save").hidden = !cw; $("#drawer-delete").hidden = true; /* excluir card segue fora do escopo (só tarefas se excluem) */
    var dh = $("#d-hist"); if (dh) dh.addEventListener("toggle", function () { if (dh.open && !dh._ok) { dh._ok = 1; carregarHistorico(c.id, dh); } });
  }
  function carregarHistorico(id, box) {
    var corpo = $(".hist-body", box), locais = E.store().historico().filter(function (x) { return String(x.cardId) === String(id); });
    var loc = locais.length ? '<h4>Neste navegador</h4><ul class="hist">' + locais.map(function (x) { var FLx = window.KanzoFields; return '<li><div class="h-t"><b>' + esc(FLx.FIELDS[x.campo].label) + '</b></div><div class="h-d"><s>' + esc(FLx.texto(x.campo, x.antes) || "vazio") + "</s> → " + esc(FLx.texto(x.campo, x.depois) || "vazio") + '</div><div class="h-m">' + esc((x.by || "você") + " · " + F.dataHora(x.at)) + "</div></li>"; }).join("") + "</ul>" : "";
    corpo.innerHTML = loc + '<div class="cmt"><small>Buscando histórico do servidor…</small></div>';
    if (!state.live) { corpo.innerHTML = loc || '<div class="cmt"><small>Sem histórico no modo snapshot.</small></div>'; return; }
    KanzoData.tryFetch("/api/cards/" + encodeURIComponent(id) + "/audit").then(function (a) {
      var ev = (a.events || []).filter(function (e) { return e.changes && e.changes.length || e.action !== "update"; });
      var srv = ev.length ? '<h4>No servidor</h4><ul class="hist">' + ev.map(function (e) {
        return '<li><div class="h-t"><b>' + esc(e.action === "update" ? "Edição" : e.action) + "</b> · " + esc(e.by) + '</div>' + (e.changes || []).map(function (ch) { return '<div class="h-d"><b>' + esc(ch.campo) + ":</b> <s>" + esc(ch.antes || "vazio") + "</s> → " + esc(ch.depois || "vazio") + "</div>"; }).join("") + '<div class="h-m">' + esc(F.dataHora(e.at) + " (Brasília)") + "</div></li>";
      }).join("") + "</ul>" : '<div class="cmt"><small>Nenhuma edição pelo painel registrada no servidor.</small></div>';
      corpo.innerHTML = loc + srv;
    }).catch(function (e) {
      corpo.innerHTML = loc + '<div class="cmt"><small>' + (e && e.status === 404 ? "O histórico do servidor depende da atualização do Worker (ainda não publicada)." : "Não foi possível carregar o histórico do servidor.") + "</small></div>";
    });
  }
  function closeDrawer() {
    var d = $("#drawer"); if (!d.classList.contains("open")) return;
    d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); $("#drawer-bg").classList.remove("open");
    selectedId = null; hideTip();
    if (lastOpener && document.contains(lastOpener)) lastOpener.focus();
  }
  function findIdx(id) { for (var i = 0; i < state.cards.length; i++) if (String(state.cards[i].id) === String(id)) return i; return -1; }
  async function saveDrawer() {
    if (!canWrite() || selectedId == null) return;
    var idx = findIdx(selectedId), prev = Object.assign({}, state.cards[idx]), id = selectedId;
    var t = $("#f-title"), d = $("#f-desc");
    var patch = window.KanzoDrawerPatch.patchSalvarDrawer({
      prev: prev, title: t ? t.value : null,
      descHabilitada: !!(d && !d.disabled), descNovo: d ? d.value : null, descInicial: descDrawerInicial
    });
    var body = $("#f-comment") && $("#f-comment").value.trim();
    if (patch.title === "") { toast("O título não pode ficar vazio."); t.focus(); return; }
    if (!Object.keys(patch).length && !body) { toast(E.store().resumo().saved || E.store().resumo().saving ? "Os campos já salvam sozinhos." : "Nada para salvar."); return; }
    if (Object.keys(patch).length) {
      state.cards[idx] = Object.assign({}, prev, patch, patch.stage ? { stage_label: (state.stages.filter(function (s) { return s.key === patch.stage; })[0] || {}).label || patch.stage } : {}, { pending: true });
      renderAll();
    }
    var btn = $("#drawer-save"); btn.disabled = true; btn.textContent = "Salvando…";
    try {
      if (Object.keys(patch).length) {
        if (patch.description != null) { var h = await KanzoStore.sha256(descDrawerInicial || ""); if (h) patch.expect_description_sha256 = h; }
        await KanzoData.write("PATCH", "/api/cards/" + id, patch);
      }
      if (body) {
        await KanzoData.write("POST", "/api/cards/" + id + "/comments", { body: body });
        state.cards[idx].comments = (state.cards[idx].comments || []).concat([{ id: "local-" + Date.now(), author: state.me && state.me.nome, body: body, created_at: new Date().toISOString() }]);
      }
      toast("Salvo no app.");
      renderAll(); openDrawer(id, lastOpener);
    } catch (e) {
      state.cards[idx] = prev; renderAll(); openDrawer(id, lastOpener);
      toast(e.status === 409 ? "O card mudou no app enquanto você editava. Reabri com a versão nova; refaça a alteração." : "Erro ao salvar: " + e.message, e.status === 409 ? null : { label: "Tentar de novo", fn: saveDrawer });
    } finally { btn.disabled = false; btn.textContent = "Salvar"; }
  }
  async function removeCard() {
    if (!canWrite() || selectedId == null) return;
    if (!confirm("Remover “" + (state.cards[findIdx(selectedId)] || {}).title + "” da carteira? O registro fica no histórico do servidor.")) return;
    var idx = findIdx(selectedId), prev = state.cards[idx];
    state.cards[idx] = Object.assign({}, prev, { deleted_at: new Date().toISOString(), active: false });
    closeDrawer(); renderAll();
    try { await KanzoData.write("DELETE", "/api/cards/" + prev.id); toast("Projeto removido da carteira."); }
    catch (e) { state.cards[idx] = prev; renderAll(); toast("Erro ao remover: " + e.message); }
  }
  /* ---- Lote 2 nuvem: Kanban + criar completo + Mover para ---- */
  var FECHA = { "ganho-handoff": 1, "old-falhou": 1 };
  function stageLabel(key) {
    var s = (state.stages || []).filter(function (x) { return x.key === key; })[0];
    return s ? s.label : (key || "sem etapa");
  }
  function setView(v) {
    state.view = v === "board" ? "board" : "list";
    var list = state.view === "list";
    $("#view-list").setAttribute("aria-pressed", String(list));
    $("#view-board").setAttribute("aria-pressed", String(!list));
    $("#card-list").hidden = !list;
    $("#kanban-board").hidden = list;
    if (!list) $("#list-more").hidden = true;
    if (list) renderList(); else renderKanban();
    try { localStorage.setItem(MOBILE.matches ? "kanzo-view-m" : "kanzo-view", state.view); } catch (_) {}
  }
  function optsEtapa(sel) {
    return (state.stages || []).map(function (s) {
      return '<option value="' + esc(s.key) + '"' + (s.key === sel ? " selected" : "") + ">" + esc(s.label) + "</option>";
    }).join("");
  }
  async function moveCard(id, stage) {
    if (!canWrite() || !stage) return;
    var idx = findIdx(id); if (idx < 0) return;
    var prev = state.cards[idx];
    if (prev.stage === stage) return;
    if (FECHA[stage] || FECHA[prev.stage]) {
      if (!confirm("Confirma mover “" + prev.title + "” para “" + stageLabel(stage) + "”?")) return;
    }
    var patch = window.KanzoDrawerPatch.patchMoverEtapa(stage);
    state.cards[idx] = Object.assign({}, prev, { stage: stage, stage_label: stageLabel(stage), pending: true });
    renderAll();
    try {
      await KanzoData.write("PATCH", "/api/cards/" + id, patch);
      var sug = T && window.KanzoCore ? T.sugestoesPendentes(Object.assign({}, prev, { stage: stage }), tarefasDoCard(id)) : [];
      toast("Etapa: " + stageLabel(stage) + "." + (sug.length ? " " + sug.length + (sug.length === 1 ? " tarefa sugerida" : " tarefas sugeridas") + " no card." : ""));
      renderAll(); if (String(selectedId) === String(id)) renderDrawer(state.k.list.filter(function (x) { return String(x.id) === String(id); })[0] || prev);
    } catch (e) {
      state.cards[idx] = prev; renderAll();
      if (String(selectedId) === String(id)) openDrawer(id, lastOpener);
      toast("Erro ao mover: " + e.message);
    }
  }
  /* Remodelo 11/11: status direto do cabeçalho do card (grava na hora, como a etapa). */
  async function mudarStatus(id, status) {
    if (!canWrite() || !status) return;
    var idx = findIdx(id); if (idx < 0) return;
    var prev = state.cards[idx]; if (prev.status === status) return;
    state.cards[idx] = Object.assign({}, prev, { status: status });
    renderAll();
    try { await KanzoData.write("PATCH", "/api/cards/" + id, { status: status }); toast("Status: " + F.statusLabel(status) + "."); renderAll(); }
    catch (e) { state.cards[idx] = prev; renderAll(); toast("Erro ao mudar o status: " + e.message); }
    if (String(selectedId) === String(id)) openDrawer(id, lastOpener);
  }
  function renderKanban() {
    var board = $("#kanban-board"); if (!board || state.view !== "board") return;
    var list = visibleCards(), cw = canWrite(), urgB = urgTarefas();
    var por = {}; list.forEach(function (c) { var k = c.stage || "_sem"; (por[k] = por[k] || []).push(c); });
    var stages = (state.stages || []).slice();
    if (por._sem) stages = stages.concat([{ key: "_sem", label: "Sem etapa" }]);
    board.innerHTML = stages.map(function (s) {
      var cards = por[s.key] || [];
      return '<section class="kcol" data-stage="' + esc(s.key) + '" aria-label="' + esc(s.label) + '">' +
        '<div class="kcol-h"><b>' + esc(s.label) + '</b><span class="n">' + cards.length + "</span></div>" +
        '<div class="kcol-b" data-drop="' + esc(s.key) + '">' +
        (cards.length ? cards.map(function (c) {
          var urgK = urgB, sub = [K.semSolucao(c) ? "Solução a definir" : c.solution].filter(Boolean).join(" · ");
          var mover = cw ? '<label class="kmover"><span class="sr-only">Mover ' + esc(c.title) + ' para</span><select class="sel" data-mover="' + esc(c.id) + '" aria-label="Mover para etapa">' +
            '<option value="">Mover para…</option>' + optsEtapa(c.stage) + "</select></label>" : "";
          return '<article class="kcard" draggable="' + (cw ? "true" : "false") + '" tabindex="0" data-id="' + esc(c.id) + '" data-act="open:' + esc(c.id) + '">' +
            '<div class="kt">' + esc(c.title) + saveDot(c) + avisoTag(c) + '</div>' +
            (sub ? '<div class="ks">' + esc(sub) + "</div>" : "") +
            '<div class="kmeta">' + (c.atrasado && c.status !== "done" ? '<span class="tag bad">atrasado</span>' : '<span class="tag dim">' + esc(F.statusLabel(c.status)) + "</span>") + tagTarefas(c, urgK) + tagDocs(c) + "</div>" +
            mover + "</article>";
        }).join("") : '<div class="kempty">Nenhum card</div>') +
        "</div></section>";
    }).join("");
  }
  function abrirNovo() {
    if (!canWrite()) return;
    var st = $("#new-stage");
    st.innerHTML = optsEtapa("recebimento-do-projeto");
    if (!st.value) st.value = "recebimento-do-projeto";
    $("#new-form").reset();
    st.value = "recebimento-do-projeto";
    $("#new-bg").hidden = false; $("#new-bg").classList.add("open");
    $("#new-modal").hidden = false;
    setTimeout(function () { $("#new-name").focus(); }, 20);
  }
  function fecharNovo() {
    $("#new-bg").classList.remove("open"); $("#new-bg").hidden = true; $("#new-modal").hidden = true;
  }
  async function createCard(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!canWrite()) return;
    if ($("#new-modal").hidden) { abrirNovo(); return; }
    var title = ($("#new-name").value || "").trim();
    if (!title) { toast("Informe o título."); $("#new-name").focus(); return; }
    var stage = $("#new-stage").value || "recebimento-do-projeto";
    var desc = ($("#new-desc").value || "").trim();
    var prazo = $("#new-prazo").value || "";
    var saude = $("#new-saude").value || "";
    try {
      if (prazo) desc = window.KanzoFields.set(desc, "prazo", prazo);
      if (saude) desc = window.KanzoFields.set(desc, "saude", saude);
    } catch (e) { toast(e.message); return; }
    var temp = { id: "tmp-" + Date.now(), title: title, status: "todo", stage: stage, stage_label: stageLabel(stage),
      description: desc, solution: "A definir", values: {}, comments: [], active: true, pending: true,
      updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
    state.cards.unshift(temp); fecharNovo(); renderAll();
    try {
      var created = await KanzoData.write("POST", "/api/cards", { title: title, status: "todo", stage: stage, description: desc });
      var i = findIdx(temp.id);
      state.cards[i] = Object.assign({}, temp, created || {}, { id: (created && created.id) || temp.id });
      renderAll(); toast("Projeto criado. Complete os campos e crie as tarefas.");
      openDrawer((created && created.id) || temp.id);
    } catch (e) {
      state.cards = state.cards.filter(function (c) { return c.id !== temp.id; }); renderAll();
      toast("Erro ao criar: " + e.message);
    }
  }

  /* ---------------- Lote 2: filtros globais na URL e filtro cruzado ---------------- */
  var URLP = { etapa: "stage", status: "status", solucao: "fam", resp: "resp", saude: "saude", periodo: "periodo", prazo: "prazo", chip: "chip", q: "q", ordem: "sort" };
  var ROT_F = { stage: "Etapa", status: "Status", fam: "Solução", resp: "Responsável", saude: "Saúde", periodo: "Criado no Planner", prazo: "Prazo" };
  function periodoDe(c) { var d = c._planner && c._planner.criado; return d ? d.slice(0, 7) : "sem-data"; }
  function mesTxt(p) { if (p === "sem-data") return "sem data"; var m = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; return m[+p.slice(5, 7) - 1] + "/" + p.slice(0, 4); }
  /* exceto: dimensão que o próprio gráfico mostra (fica fora do filtro dele, para ver o selecionado no contexto). */
  function passa(c, fl, exceto) {
    if (fl.stage && exceto !== "stage" && c.stage !== fl.stage) return false;
    if (fl.status && exceto !== "status" && c.status !== fl.status) return false;
    if (fl.fam && exceto !== "fam") { var re = famRe(fl.fam); if (K.semSolucao(c) || !(re ? re.test(c.solution) : !K.FAMILIAS.some(function (x) { return x.re.test(c.solution); }))) return false; }
    if (fl.resp && exceto !== "resp" && c._fatos.responsaveis.indexOf(fl.resp) < 0) return false;
    if (fl.saude && exceto !== "saude" && c._saude.key !== fl.saude) return false;
    if (fl.periodo && exceto !== "periodo" && periodoDe(c) !== fl.periodo) return false;
    if (fl.prazo && exceto !== "prazo" && K.faixaPrazo(c) !== fl.prazo) return false;
    return true;
  }
  function temFiltroGlobal(fl) { fl = fl || state.filter; return !!(fl.stage || fl.status || fl.fam || fl.resp || fl.saude || fl.periodo || fl.prazo); }
  /* KPIs recalculados com os filtros globais, menos a dimensão "exceto". Sem filtro = o mesmo cálculo da carteira inteira. */
  function kDe(exceto) {
    exceto = exceto || "";
    if (!temFiltroGlobal()) return state.k;
    if (state.kCache[exceto]) return state.kCache[exceto];
    var fl = state.filter;
    return (state.kCache[exceto] = K.compute(state.k.list.filter(function (c) { return passa(c, fl, exceto); }), state.stages, Date.now()));
  }
  function alternarFiltro(dim, v) {
    var fl = state.filter;
    fl[dim] = fl[dim] === v ? "" : v; fl.limit = 25;
    if (dim === "resp" && fl.resp) fl.chip = "abertos";
    if (dim !== "resp" && fl[dim] && fl.chip === "abertos") { fl.chip = "todos"; state.chipAuto = true; }
    voltarChip();
    sincronizarControles(); aplicarFiltros(true);
  }
  /* O filtro cruzado troca "Abertos" por "Todos" na carteira; sem filtro nenhum, volta ao padrão. */
  function voltarChip() { if (state.chipAuto && !temFiltroGlobal() && state.filter.chip === "todos") { state.filter.chip = "abertos"; state.chipAuto = false; } }
  function aplicarFiltros(anunciar) {
    state.kCache = {};
    renderFiltrados(); escreverURL();
    if (anunciar) {
      var n = visibleCards().length, fl = state.filter, partes = Object.keys(ROT_F).filter(function (d) { return fl[d]; }).map(function (d) { return ROT_F[d] + ": " + valorTxt(d, fl[d]); });
      $("#sr-status").textContent = (partes.length ? "Filtros: " + partes.join("; ") + ". " : "Sem filtros. ") + n + " projetos na carteira.";
    }
  }
  function valorTxt(d, v) {
    if (d === "stage") { var s = (state.stages || []).filter(function (x) { return x.key === v; })[0]; return s ? s.label : v; }
    if (d === "status") return F.statusLabel(v);
    if (d === "saude") return K.SAUDE_ROT[v] || v;
    if (d === "periodo") return mesTxt(v);
    if (d === "prazo") return K.FAIXA_ROT[v] || v;
    if (d === "resp") return primeiroNome(v);
    return v;
  }
  function renderFiltrosAtivos() {
    var fl = state.filter, dims = Object.keys(ROT_F).filter(function (d) { return fl[d]; });
    var html = dims.length ? '<span class="fbar-t">Filtros:</span>' + dims.map(function (d) {
      return '<button type="button" class="chip on" data-act="clear:' + d + '">' + esc(ROT_F[d] + ": " + valorTxt(d, fl[d])) + ' <span aria-hidden="true">✕</span><span class="sr-only">(remover)</span></button>';
    }).join("") + '<button type="button" class="btn btn-sm btn-ghost" data-act="clear:todos">Limpar todos</button>' : "";
    $$(".fbar").forEach(function (b) { b.innerHTML = html; b.hidden = !dims.length; });
  }
  function renderFiltrados() { renderFiltrosAtivos(); renderFunil(state.k); renderRanking(); renderSaude(); if (state.view === "board") renderKanban(); else renderList(); }
  /* ---------------- Lote 5: ranking por TCV (só cards reais com TCV; nada calculado de updated_at) ---------------- */
  /* Item 1: tempo na etapa = dias desde a última MUDANÇA registrada em stage_history (/api/stage-history). Sem registro = "sem dado". */
  var ORIGEM_ET = { kanzo: "mudança no Kanzo", painel: "mudança pelo painel", criacao: "card criado nessa etapa" };
  function tempoEtapaTd(c) {
    var e = state.etapas && state.etapas[c.id];
    if (!e || e.dias_na_etapa == null) {
      var tipS = e && e.observado_desde ? "Sem mudança de etapa registrada. O registro começou em " + F.data(e.observado_desde.slice(0, 10)) + "; o card já estava nesta etapa." : "Sem registro de mudança de etapa.";
      return '<td class="num dim" data-tip="' + esc(tipS) + '">sem dado</td>';
    }
    return '<td class="num" data-tip="' + esc("Na etapa desde " + F.dataHora(e.na_etapa_desde) + " (Brasília), " + (ORIGEM_ET[e.origem] || e.origem) + ".") + '">' + esc(e.dias_na_etapa + (e.dias_na_etapa === 1 ? " dia" : " dias")) + '</td>';
  }
  function carregarEtapas() {
    if (!state.live) { state.etapas = null; return; }
    KanzoData.tryFetch("/api/stage-history").then(function (r) {
      var m = {}; ((r && r.cards) || []).forEach(function (x) { m[x.card_id] = x; }); state.etapas = m; if (state.k) renderRanking();
    }).catch(function () { state.etapas = null; });
  }
  function renderRanking() {
    var k = kDe(""), cs = k.comValor.slice(0, 10), box = $("#ranking");
    $("#rk-meta").textContent = k.comValor.length ? (cs.length < k.comValor.length ? "top " + cs.length + " de " + k.comValor.length : cs.length + " com TCV") : "";
    if (!cs.length) {
      box.innerHTML = '<div class="empty"><span><b>Nenhum projeto com TCV registrado' + (temFiltroGlobal() ? " nesta seleção" : "") + '</b>O ranking só mostra cards com linha de TCV na descrição; não completamos com estimativas.</span></div>';
      return;
    }
    var rs = state.rkSort || (state.rkSort = { col: "tcv", dir: "desc" });
    var linhas = cs.map(function (c, i) {
      var cr = c._planner && c._planner.criado, d = cr ? F.diasAte(cr, Date.now()) : null;
      var e = state.etapas && state.etapas[c.id];
      return { c: c, i: i, cr: cr, d: d, dias: d == null ? null : -d, et: e && e.dias_na_etapa != null ? e.dias_na_etapa : null };
    });
    var chave = { rank: function (x) { return x.i; }, title: function (x) { return (x.c.title || "").toLowerCase(); }, stage: function (x) { return (x.c.stage_label || x.c.stage || "").toLowerCase(); },
      tcv: function (x) { return x.c._val.tcv; }, dias: function (x) { return x.dias; }, etapa: function (x) { return x.et; } }[rs.col] || function (x) { return x.i; };
    linhas.sort(function (a, b) {
      var va = chave(a), vb = chave(b);
      if (va == null && vb == null) return a.i - b.i;
      if (va == null) return 1; if (vb == null) return -1; /* "sem dado" sempre no fim */
      var r = va < vb ? -1 : va > vb ? 1 : 0;
      return (rs.dir === "desc" ? -r : r) || a.i - b.i;
    });
    function th(col, rot, cls) {
      var on = rs.col === col;
      return '<th scope="col"' + (cls ? ' class="' + cls + '"' : "") + ' aria-sort="' + (on ? (rs.dir === "asc" ? "ascending" : "descending") : "none") + '"><button type="button" class="sort-btn" data-act="rk:' + col + '">' + rot + "</button></th>";
    }
    box.innerHTML = '<div class="rk-wrap"><table class="rk"><caption class="sr-only">Ranking por TCV, até 10 projetos. Use os títulos das colunas para ordenar.</caption><thead><tr>' +
      th("rank", "#") + th("title", "Projeto") + th("stage", "Etapa") + th("tcv", "TCV", "num") + th("dias", "Dias desde a criação (Planner)", "num") + th("etapa", "Tempo na etapa", "num") + '</tr></thead><tbody>' +
      linhas.map(function (x) {
        var c = x.c, cr = x.cr, d = x.d;
        var dias = d == null ? "sem data" : (-d) + (d === -1 ? " dia" : " dias");
        return '<tr><td class="num">' + (x.i + 1) + '</td><td class="rk-t"><button type="button" class="lnk" data-act="open:' + esc(c.id) + '">' + esc(c.title) + '</button></td><td>' + esc(c.stage_label || c.stage || "") +
          '</td><td class="num"><b>' + esc(F.brlCurto(c._val.tcv)) + '</b></td><td class="num' + (d == null ? " dim" : "") + '"' + (cr ? ' data-tip="' + esc("Criado no Planner em " + F.data(cr)) + '"' : "") + '>' + esc(dias) + '</td>' + tempoEtapaTd(c) + '</tr>';
      }).join("") + "</tbody></table></div>";
  }
  /* ---------------- Lote 4: saúde, prazos e evolução mensal (datas do Planner) ---------------- */
  var SAUDE_COR = { "critico": "late", "em-risco": "late", "atencao": "warn", "aguardando-externo": "info", "no-prazo": "ok", "sem-dado": "dim" };
  function renderSaude() {
    var fl = state.filter, k = kDe("saude");
    var ordem = ["critico", "em-risco", "atencao", "aguardando-externo", "no-prazo"], keys = Object.keys(k.saude);
    keys.sort(function (a, b) { var ia = ordem.indexOf(a), ib = ordem.indexOf(b); return (ia < 0 ? 90 : ia) - (ib < 0 ? 90 : ib) || (a === "sem-dado") - (b === "sem-dado"); });
    var abertosK = keys.reduce(function (s, x) { return s + k.saude[x]; }, 0);
    C.hbars($("#saude-bars"), keys.map(function (x) {
      return { label: K.SAUDE_ROT[x] || x, value: k.saude[x], action: "f:saude:" + x, sel: fl.saude === x, cls: SAUDE_COR[x],
        tip: (K.SAUDE_ROT[x] || x) + ": " + k.saude[x] + " abertos" + (x === "sem-dado" ? "\nSem linha “Saúde:” na descrição nem tag health:." : "") + "\nClique para filtrar." };
    }), { titulo: "Saúde dos projetos abertos", colunas: ["Saúde", "Abertos"], total: abertosK,
      empty: '<div class="empty"><span><b>Nenhum projeto aberto nesta seleção</b>Tire um filtro para ver a saúde.</span></div>' });
    $("#saude-meta").textContent = abertosK ? (k.saude["sem-dado"] || 0) + " de " + abertosK + " sem dado" : "";
    /* Lote 8: prazos dos abertos vira anel por faixa; as faixas ficam com cor própria e filtram. */
    var fx = ["vencido", "7d", "30d", "depois", "sem-prazo"];
    var abertosP = fx.reduce(function (s, x) { return s + (k.prazos[x] || 0); }, 0);
    var FAIXA_COR = { vencido: "var(--danger)", "7d": "var(--warn)", "30d": "var(--accent)", depois: "var(--c3)", "sem-prazo": "var(--text-3)" };
    C.anel($("#prazo-bars"), abertosP ? fx.filter(function (x) { return k.prazos[x]; }).map(function (x) {
      return { label: K.FAIXA_ROT[x], value: k.prazos[x], color: FAIXA_COR[x], action: "f:prazo:" + x, sel: fl.prazo === x,
        tip: K.FAIXA_ROT[x] + ": " + k.prazos[x] + " abertos\nPrazo efetivo: Prazo Kanzo, senão data de conclusão do Planner (Brasília).\nClique para filtrar." };
    }) : [], { titulo: "Prazos dos projetos abertos", colunas: ["Faixa de prazo", "Abertos"], centro: String(abertosP), centroSub: "abertos",
      empty: '<div class="empty"><span><b>Nenhum projeto aberto nesta seleção</b>OLD/FALHOU e concluídos ficam fora.</span></div>' });
    $("#prazo-meta").textContent = abertosP ? (k.prazos["sem-prazo"] || 0) + " sem prazo" : "";
    k = kDe("periodo");
    var mz = k.mensal, nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    /* Repaginação clara 13/11: evolução mensal em colunas agrupadas (criados e concluídos), como no frame
       de Saúde. Mesmos números e o mesmo filtro por mês; C.linha continua disponível em charts.js. */
    C.colunas($("#mensal"), mz.meses.map(function (r) {
      return { label: mesTxt(r.mes), curto: nomes[+r.mes.slice(5, 7) - 1], valores: [r.criados, r.concluidos], action: r.criados ? "f:periodo:" + r.mes : "", sel: fl.periodo === r.mes };
    }), [{ nome: "Criados" }, { nome: "Concluídos" }], { titulo: "Evolução mensal: criados e concluídos (datas do Planner, últimos 12 meses)",
      empty: '<div class="empty"><span><b>Sem datas do Planner nos últimos 12 meses</b>A evolução usa “Criado em” e “Concluído em” da linha Datas Planner da descrição.</span></div>' });
    var semd = [];
    if (mz.semCriado) semd.push(mz.semCriado + " sem data de criação");
    if (mz.concluidosSemData) semd.push(mz.concluidosSemData + " concluídos sem data de conclusão");
    if (mz.criadosAntes) semd.push(mz.criadosAntes + " criados antes de " + mesTxt(mz.meses[0].mes));
    $("#mensal-nota").textContent = "Sem data: " + (semd.length ? semd.join(" · ") : "nenhum card") + ".";
  }
  function preencherFiltros(k) {
    var sa = {}, pe = {};
    k.list.forEach(function (c) { sa[c._saude.key] = c._saude.label; pe[periodoDe(c)] = 1; });
    var fs = $("#f-saude-filter"), fp = $("#f-periodo-filter");
    fs.innerHTML = '<option value="">Toda saúde</option>' + Object.keys(sa).sort().map(function (key) { return '<option value="' + esc(key) + '">' + esc(sa[key]) + "</option>"; }).join("");
    fp.innerHTML = '<option value="">Todo período (Planner)</option>' + Object.keys(pe).sort().reverse().map(function (p) { return '<option value="' + esc(p) + '">' + esc(p === "sem-data" ? "Sem data no Planner" : "Criado em " + mesTxt(p)) + "</option>"; }).join("");
    sincronizarControles();
  }
  function sincronizarControles() {
    var fl = state.filter;
    $("#q").value = fl.q; $("#f-stage-filter").value = fl.stage; $("#f-status-filter").value = fl.status; $("#f-sort").value = fl.sort;
    $("#f-saude-filter").value = fl.saude; $("#f-periodo-filter").value = fl.periodo;
  }
  function lerURL() {
    var sp; try { sp = new URLSearchParams(location.search); } catch (_) { return; }
    Object.keys(URLP).forEach(function (p) { var v = sp.get(p); if (v != null && v !== "") state.filter[URLP[p]] = v.slice(0, 120); });
    if (!CHIPS.some(function (c) { return c.id === state.filter.chip; })) state.filter.chip = "abertos";
    if (["acao", "recente", "prazo", "valor", "titulo"].indexOf(state.filter.sort) < 0) state.filter.sort = "acao";
    if (state.filter.chip === "todos" && temFiltroGlobal()) state.chipAuto = true;
  }
  function escreverURL() {
    if (!window.history || !history.replaceState) return;
    var fl = state.filter, pad = filtroPadrao(), sp = new URLSearchParams();
    Object.keys(URLP).forEach(function (p) { var v = fl[URLP[p]]; if (v && v !== pad[URLP[p]]) sp.set(p, v); });
    var qs = sp.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (_) {}
  }

  /* ---------------- ações ---------------- */
  function irCarteira() { if (state.visao !== "carteira") setVisao("carteira", true, false); var s = $("#carteira"); if (s._open) s._open(); s.scrollIntoView({ block: "start" }); }
  function act(a, el) {
    var i = a.indexOf(":"), k = a.slice(0, i), v = a.slice(i + 1), fl = state.filter;
    if (k === "open") return openDrawer(v, el);
    if (k === "rk") { var rs = state.rkSort || { col: "rank", dir: "asc" }; state.rkSort = { col: v, dir: rs.col === v && rs.dir === "asc" ? "desc" : (rs.col === v ? "asc" : (v === "tcv" || v === "dias" || v === "etapa" ? "desc" : "asc")) }; renderRanking(); var bt = $('#ranking [data-act="rk:' + v + '"]'); if (bt) bt.focus(); return; }
    if (k === "f") { var j = v.indexOf(":"); return alternarFiltro(v.slice(0, j), v.slice(j + 1)); }
    if (k === "chip") { fl.chip = v; fl.limit = 25; aplicarFiltros(); if (!el.closest("#chips")) irCarteira(); return; }
    if (k === "clear") { if (v === "todos") { var so = fl.sort; state.filter = filtroPadrao(); state.filter.sort = so; state.chipAuto = false; sincronizarControles(); } else { fl[v] = ""; voltarChip(); } aplicarFiltros(true); return; }
    fl.chip = "todos"; fl.limit = 25;
    if (k === "stage") { fl.stage = v; $("#f-stage-filter").value = v; }
    if (k === "status") { fl.status = v; $("#f-status-filter").value = v; }
    if (k === "fam") fl.fam = v;
    if (k === "resp") { fl.resp = v; fl.chip = "abertos"; }
    if (k === "saude") { fl.saude = v; fl.chip = "abertos"; sincronizarControles(); }
    aplicarFiltros(true); irCarteira();
  }
  function bindUI() {
    $("#btn-refresh").addEventListener("click", function () { boot(true); });
    $("#btn-logout").addEventListener("click", async function () {
      try { await KanzoData.tryFetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-MCO": "1" }, body: "{}" }); } catch (_) {}
      location.replace("/login");
    });
    $("#btn-new").addEventListener("click", function () { abrirNovo(); });
    $("#new-cancel").addEventListener("click", fecharNovo);
    $("#new-bg").addEventListener("click", fecharNovo);
    $("#new-form").addEventListener("submit", createCard);
    /* Remodelo 11/11: no celular a Carteira abre em lista (o quadro de colunas fica apertado); o quadro continua a um toque. */
    /* 12/11: no celular sempre abre em lista (pedido do Guilherme); no computador vale a última escolha. */
    if (MOBILE.matches) state.view = "list"; else try { var vv = localStorage.getItem("kanzo-view"); if (vv === "board" || vv === "list") state.view = vv; } catch (_) {}
    $("#view-list").addEventListener("click", function () { setView("list"); });
    $("#view-board").addEventListener("click", function () { setView("board"); });
    setView(state.view);
    var dragId = null;
    $("#kanban-board").addEventListener("dragstart", function (e) {
      var c = e.target.closest(".kcard"); if (!c || !canWrite()) return;
      dragId = c.getAttribute("data-id"); c.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (_) {}
    });
    $("#kanban-board").addEventListener("dragend", function (e) {
      var c = e.target.closest(".kcard"); if (c) c.classList.remove("dragging");
      $$(".kcol.drag-over", $("#kanban-board")).forEach(function (x) { x.classList.remove("drag-over"); });
      dragId = null;
    });
    $("#kanban-board").addEventListener("dragover", function (e) {
      if (!canWrite()) return;
      var col = e.target.closest(".kcol"); if (!col) return;
      e.preventDefault(); col.classList.add("drag-over");
    });
    $("#kanban-board").addEventListener("dragleave", function (e) {
      var col = e.target.closest(".kcol"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("drag-over");
    });
    $("#kanban-board").addEventListener("drop", function (e) {
      var col = e.target.closest(".kcol"); if (!col || !canWrite()) return;
      e.preventDefault(); col.classList.remove("drag-over");
      var id = dragId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      var stg = col.getAttribute("data-stage");
      if (id && stg && stg !== "_sem") moveCard(id, stg);
    });
    $("#kanban-board").addEventListener("change", function (e) {
      var sel = e.target.closest("select[data-mover]"); if (!sel) return;
      var id = sel.getAttribute("data-mover"), stg = sel.value;
      sel.value = "";
      if (stg) moveCard(id, stg);
    });
    $("#kanban-board").addEventListener("click", function (e) {
      if (e.target.closest("select[data-mover], label.kmover")) e.stopPropagation();
    }, true);
    $("#q").addEventListener("input", function (e) { state.filter.q = e.target.value.trim(); state.filter.limit = 25; aplicarFiltros(); });
    $("#f-stage-filter").addEventListener("change", function (e) { state.filter.stage = e.target.value; aplicarFiltros(true); });
    $("#f-status-filter").addEventListener("change", function (e) { state.filter.status = e.target.value; aplicarFiltros(true); });
    $("#f-saude-filter").addEventListener("change", function (e) { state.filter.saude = e.target.value; aplicarFiltros(true); });
    $("#f-periodo-filter").addEventListener("change", function (e) { state.filter.periodo = e.target.value; aplicarFiltros(true); });
    $("#f-sort").addEventListener("change", function (e) { state.filter.sort = e.target.value; aplicarFiltros(); });
    $("#f-limpar").addEventListener("click", function () { state.filter = filtroPadrao(); sincronizarControles(); aplicarFiltros(true); });
    $("#list-more").addEventListener("click", function () { state.filter.limit += 25; renderList(); });
    $("#acao-mais").addEventListener("click", function () { state.acaoAll = !state.acaoAll; renderAcao(state.k); });
    document.addEventListener("click", function (e) {
      var ftb = e.target.closest("[data-ft]"); if (ftb && !ftb.disabled) { e.preventDefault(); E.abrirForca(ftb.getAttribute("data-ft")); return; }
      var el = e.target.closest("[data-act]");
      if (el && !e.target.closest("button.info, .info[tabindex]")) { e.preventDefault(); act(el.getAttribute("data-act"), el); }
    });
    /* Remodelo 11/11: cabeçalho de decisão (etapa/status gravam na hora), situação vinda do texto e tarefas. */
    $("#drawer-body").addEventListener("change", function (e) {
      if (selectedId == null) return;
      if (e.target.id === "d-stage") moveCard(selectedId, e.target.value);
      else if (e.target.id === "d-status") mudarStatus(selectedId, e.target.value);
    });
    $("#drawer-body").addEventListener("click", function (e) {
      var b = e.target.closest("[data-usar-sit]"); if (!b || !canWrite() || selectedId == null) return;
      var c = rawCard(selectedId), txt = T.narrativa(c && c.description);
      if (!c || !txt) return;
      try { E.store().edit(c, "situacao", txt, { imediato: true, origem: "edicao" }); var fb = $("#sit-fb"); if (fb) fb.remove(); toast("Situação atual preenchida com o texto do card. Ajuste se precisar."); }
      catch (err) { toast("Não deu para usar o texto: " + err.message); }
    });
    if (T) T.montar({ raiz: $("#drawer-body"), card: function () { return selectedId == null ? null : (state.k && state.k.list.filter(function (x) { return String(x.id) === String(selectedId); })[0]) || rawCard(selectedId); },
      tasks: function () { return state.tasks || []; }, setTasks: function (l) { state.tasks = l; }, canWrite: canWrite, toast: toast,
      write: function (m, pth, b) { return KanzoData.write(m, pth, b); }, setEditId: function (id) { state.tkEdit = id; },
      onChange: function () { refreshTarefasDrawer(); if (state.k) { renderAcao(state.k); if (state.view === "board") renderKanban(); else renderList(); } } });
    if (D) docsCtl = D.montar({ raiz: $("#drawer-body"), card: function () { return selectedId == null ? null : (state.k && state.k.list.filter(function (x) { return String(x.id) === String(selectedId); })[0]) || rawCard(selectedId); },
      canWrite: canWrite, isAdmin: canWrite, fmt: function (x) { return F.dataHora(x); }, toast: toast,
      read: function (pth) { return KanzoData.tryFetch(pth); }, write: function (m, pth, b) { return KanzoData.write(m, pth, b); },
      copiar: copiarTexto,
      onChange: function (id, n) { if (n) state.docCounts[id] = n; else delete state.docCounts[id]; if (state.k) { if (state.view === "board") renderKanban(); else renderList(); } } });
    $("#drawer-close").addEventListener("click", closeDrawer);
    $("#drawer-cancel").addEventListener("click", closeDrawer);
    $("#drawer-bg").addEventListener("click", closeDrawer);
    $("#drawer-save").addEventListener("click", saveDrawer);
    $("#drawer-delete").addEventListener("click", removeCard);
    $("#btn-ft").addEventListener("click", function () { E.abrirForca("todos"); });
    /* Lote 6: modo apresentação (P entra/sai, Esc sai) e PDF pela impressão do navegador (@media print). */
    $("#btn-pres").addEventListener("click", function () { apresentar(true); });
    /* Lote 7: tema claro/escuro (js/tema.js). O donut lê as cores na hora de desenhar, então redesenha. */
    function marcarTema() {
      var claro = window.KanzoTema && window.KanzoTema.atual() === "claro";
      $$(".btn-tema").forEach(function (b) { b.setAttribute("aria-pressed", String(claro)); });
      $("#btn-tema").setAttribute("aria-label", claro ? "Usar tema escuro" : "Usar tema claro"); $("#btn-tema").setAttribute("data-tip", claro ? "Tema claro ligado. Clique para o escuro." : "Tema escuro ligado. Clique para o claro.");
      $("#btn-tema-2").textContent = claro ? "Tema escuro" : "Tema claro";
    }
    if (window.KanzoTema) {
      window.KanzoTema.onChange = function () { marcarTema(); if (state.k) renderFiltrados(); };
      $$(".btn-tema").forEach(function (b) { b.addEventListener("click", function () { var t = window.KanzoTema.alternar(); $("#sr-status").textContent = "Tema " + t + " ligado."; }); });
      marcarTema();
    }
    $("#btn-pres-sair").addEventListener("click", function () { apresentar(false); });
    $("#btn-pdf").addEventListener("click", function () { hideTip(); window.print(); });
    /* Lote 8: navegação de slides e tela cheia (webkit + fallback; Esc do navegador sai pela mudança de fullscreen). */
    $("#pres-prev").addEventListener("click", function () { slideIr(-1); });
    $("#pres-next").addEventListener("click", function () { slideIr(1); });
    document.addEventListener("webkitfullscreenchange", function () {
      if (!document.webkitFullscreenElement && document.body.classList.contains("apresentando")) apresentar(false);
    });
    document.addEventListener("keydown", function (e) {
      var tg = e.target, digitando = tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT");
      if (e.key === "Escape" && !$("#new-modal").hidden) { fecharNovo(); return; }
      if (e.key === "Escape" && document.body.classList.contains("apresentando") && !$("#drawer").classList.contains("open") && !E.ftAberta()) { apresentar(false); return; }
      if (!digitando && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "p" || e.key === "P") && !E.ftAberta() && !$("#drawer").classList.contains("open")) { e.preventDefault(); apresentar(!document.body.classList.contains("apresentando")); }
    });
    document.addEventListener("keydown", function (e) {
      var tg = e.target, digitando = tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT");
      if (!digitando && !e.metaKey && !e.ctrlKey && !e.altKey && !E.ftAberta() && !$("#drawer").classList.contains("open")) {
        if ((e.key === "f" || e.key === "F") && canWrite()) { e.preventDefault(); E.abrirForca("todos"); return; }
        if (e.key === "/") { e.preventDefault(); irCarteira(); $("#q").focus(); return; }
      }
      var d = $("#drawer"); if (!d.classList.contains("open")) return;
      if (e.key === "Escape") { e.preventDefault(); closeDrawer(); return; }
      if (e.key === "Tab") {
        var f = $$('button:not([disabled]):not([hidden]),input,select,textarea,summary,[tabindex="0"]', d).filter(function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    /* Lote 8: slides de apresentação por teclado (setas, Home/End; Enter avança). */
    document.addEventListener("keydown", function (e) {
      if (!document.body.classList.contains("apresentando")) return;
      var tg = e.target, digitando2 = tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT");
      if (digitando2) return;
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); slideIr(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); slideIr(-1); }
      else if (e.key === "Home") { e.preventDefault(); slideAt = 0; marcaSlide(); }
      else if (e.key === "End") { e.preventDefault(); slideAt = SLIDES.length - 1; marcaSlide(); }
    });
  }

  /* Lote 8: apresentação em 6 slides. Sem mover o DOM: slides são grupos de seletores
     já marcados com classes p-* / ids; o CSS esconde tudo menos a cadeia .cur do slide. */
  var SLIDES = [
    { nome: "Abertura", sel: ["#b-resumo .hero"] },
    { nome: "Indicadores", sel: ["#b-resumo .g-kpi", "#b-resumo .g-main"] },
    { nome: "Evolução", sel: ["#b-saude .p-evo"] },
    { nome: "Prazos e valor", sel: ["#b-saude .p-prazo", "#b-funil .rk-panel"] },
    { nome: "Funil", sel: ["#b-funil .p-funil"] },
    { nome: "Soluções", sel: ["#b-funil .p-sol"] }
  ], slideAt = 0;
  function marcaSlide() {
    $$(".cur").forEach(function (el) { el.classList.remove("cur"); });
    var s = SLIDES[slideAt]; if (!s) return;
    s.sel.forEach(function (sel) {
      $$(sel).forEach(function (el) {
        el.classList.add("cur");
        var p = el.parentElement;
        while (p && !p.classList.contains("sec")) { p.classList.add("cur"); p = p.parentElement; }
        if (p) p.classList.add("cur");
      });
    });
    document.body.setAttribute("data-slidex", String(slideAt + 1));
    var cnt = $("#pres-count"); if (cnt) cnt.textContent = (slideAt + 1) + " / " + SLIDES.length + " · " + s.nome;
  }
  function slideIr(d) {
    var n = Math.min(SLIDES.length - 1, Math.max(0, slideAt + d));
    if (n === slideAt) return;
    slideAt = n; marcaSlide();
    $("#sr-status").textContent = "Slide " + (slideAt + 1) + " de " + SLIDES.length + ": " + SLIDES[slideAt].nome + ".";
  }
  function telaCheia(on) {
    var el = document.documentElement;
    try {
      if (on && el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
      if (!on && document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) {}
  }
  function apresentar(on) {
    var b = document.body; if (b.classList.contains("apresentando") === on) return;
    hideTip(); b.classList.toggle("apresentando", on); $("#pres-bar").hidden = !on;
    if (on) { $$(".sec").forEach(function (s) { if (s.classList.contains("closed")) { s.classList.remove("closed"); s._presAbriu = true; } }); slideAt = 0; marcaSlide(); telaCheia(true); $("#btn-pres-sair").focus(); }
    else { $$(".sec").forEach(function (s) { if (s._presAbriu) { s.classList.add("closed"); s._presAbriu = false; } }); $$(".cur").forEach(function (el) { el.classList.remove("cur"); }); document.body.removeAttribute("data-slidex"); telaCheia(false); $("#btn-pres").focus(); }
    $("#sr-status").textContent = on ? "Modo apresentação ligado. Esc sai." : "Modo apresentação desligado.";
  }
  /* Lote 8: visões resumo / funil / soluções. Estado em body[data-visao], hash na URL e
     sincronizado com o secnav (os itens resumo/funil do menu entram/levem pra visão). */
  var VISOES = ["carteira", "resumo", "funil", "saude", "qualidade"];
  /* Remodelo 11/11: um menu só (Carteira, Resumo, Funil, Saúde, Qualidade); cada item mostra a sua seção.
     "Soluções" virou parte do Funil (#solucoes abre o Funil já no painel de soluções). Abertura: Carteira. */
  function setVisao(v, salvaHash, rolar) {
    var alvoSol = v === "solucoes";
    if (alvoSol) v = "funil";
    if (VISOES.indexOf(v) < 0) v = "carteira";
    var mudou = state.visao !== v;
    state.visao = v;
    document.body.setAttribute("data-visao", v);
    $$(".secnav a").forEach(function (a) {
      var on = a.getAttribute("data-nav") === v;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var sec = document.getElementById(v); if (sec && sec._open) sec._open();
    if (mudou && v === "resumo") contarHero();
    if (salvaHash && window.history && history.replaceState) {
      try { history.replaceState(null, "", location.pathname + location.search + "#" + (alvoSol ? "solucoes" : v)); } catch (_) {}
    }
    if (alvoSol) { var ps = $("#b-funil .p-sol"); if (ps) ps.scrollIntoView({ block: "start" }); }
    else if (rolar !== false && mudou) window.scrollTo(0, 0);
  }
  function bindVisoes() {
    $$(".secnav a").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); setVisao(a.getAttribute("data-nav"), true); });
    });
    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").replace("#", "");
      if (VISOES.indexOf(h) >= 0 || h === "solucoes") setVisao(h, false);
    });
    var h0 = (location.hash || "").replace("#", "");
    setVisao(VISOES.indexOf(h0) >= 0 || h0 === "solucoes" ? h0 : "carteira", false, false);
  }
  /* Lote 8: conteúdo que entra (revv) observado uma vez; sem IntersectionObserver ou com
     movimento reduzido, tudo já aparece pronto. Impressão também resolve. */
  function todos() {
    $$(".revv").forEach(function (el) { el.classList.add("revv-on"); });
    $$("main .linha").forEach(function (el) { el.classList.add("reve"); });
  }
  function montarRevelar() {
    if (RM.matches || !("IntersectionObserver" in window)) { todos(); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("revv-on"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -10% 0px" });
    $$(".revv").forEach(function (el) { io.observe(el); });
  }
  addEventListener("beforeprint", todos);
  function renderAll() {
    var k = state.k = K.compute(E ? E.efetivos(state.cards) : state.cards, state.stages, Date.now());
    state.kCache = {};
    renderHeader(); renderKPIs(k); renderHero(k); renderAcao(k); renderValor(k); preencherFiltros(k); renderFiltrados(); renderQualidade(k);
  }
  /* Lote 0: seções 02+ e rodapé só aparecem junto com os dados (entram abaixo, sem empurrar nada já pintado). */
  function prontoParaMostrar() { document.body.classList.remove("pre-carga"); $("#kpis").removeAttribute("aria-busy"); }
  function estadoErro(e) {
    var note = $("#write-note"); note.classList.remove("carregando", "note-admin"); note.classList.add("erro");
    note.hidden = false;
    note.textContent = "Não foi possível carregar os dados agora.";
    $("#kpis").removeAttribute("aria-busy"); $("#kpis").innerHTML = ""; $("#ganhos-list").innerHTML = "";
    /* Remodelo 11/11: a Carteira abre primeiro e o Resumo só aparece depois da carga; o erro fica no bloco Exige ação. */
    $("#acao-list").innerHTML = '<li class="empty estado-erro" role="alert"><span><b>Erro ao carregar os dados</b>' + esc((e && e.message) || "Falha de rede.") +
      ' A tela não mostra números até a leitura funcionar.</span><button type="button" class="btn btn-sm" id="btn-retry">Tentar novamente</button></li>';
    $("#btn-retry").addEventListener("click", function () { boot(true); });
  }
  async function copiarTexto(txt) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); return true; } } catch (_) {}
    try { var ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", ""); ta.className = "u-offscreen"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok; } catch (_) { return false; }
  }
  /* 18/11: quantos links cada card tem (só para o ícone da lista/funil). Falha aqui não muda nada. */
  var lendoDc = false;
  async function carregarDocCounts() {
    if (!D || !state.live || lendoDc) return; lendoDc = true;
    try {
      var r = await KanzoData.tryFetch("/api/docs/counts"), c = (r && r.counts) || {};
      if (JSON.stringify(c) === JSON.stringify(state.docCounts)) return;
      state.docCounts = c; if (!state.k) return;
      if (state.view === "board") renderKanban(); else renderList();
    } catch (_) {} finally { lendoDc = false; }
  }
  /* Remodelo 11/11: tarefas dos cards (GET /api/tasks). Falha aqui não derruba a carteira; o bloco do card mostra o erro. */
  var lendoTk = false;
  async function carregarTarefas() {
    if (!T) return;
    if (!state.live) { if (state.tasks == null) { state.tasks = []; } return; }
    if (lendoTk) return; lendoTk = true;
    try {
      var r = await KanzoData.tryFetch("/api/tasks");
      var lista = Array.isArray(r) ? r : (r && r.tasks) || [], ass = JSON.stringify(lista);
      state.tasksErro = "";
      if (ass === state.tkAssin) return;
      state.tkAssin = ass; state.tasks = lista;
    } catch (e) {
      if (state.tasks != null) return;
      state.tasksErro = "Não deu para ler as tarefas agora (" + ((e && e.message) || "falha de rede") + ").";
    } finally { lendoTk = false; }
    if (!state.k) return;
    renderAcao(state.k);
    if (state.view === "board") renderKanban(); else renderList();
    var box = $("#d-tasks"), ativo = document.activeElement;
    if (!(box && ativo && box.contains(ativo) && /INPUT|TEXTAREA/.test(ativo.tagName))) refreshTarefasDrawer();
  }
  async function boot(manual) {
    var btn = $("#btn-refresh"); if (manual) btn.disabled = true;
    try {
      var data = await KanzoData.load();
      state.live = !!data.live; state.label = data.label; state.meta = data.meta || {}; state.me = data.me || null;
      state.sync = data.sync || (data.meta && data.meta.sync) || null; state.fallbackError = data.fallbackError || "";
      state.stages = data.stages && data.stages.length ? data.stages : (window.KANZO_SNAPSHOT && KANZO_SNAPSHOT.stages) || [];
      state.cards = data.cards || []; state.loadedAt = new Date().toISOString();
      if (E && state.live) E.reconciliar(state.cards, state.sync);
      if (!state.urlLida) { state.urlLida = true; lerURL(); }
      var sf = $("#f-stage-filter"), cur = state.filter.stage;
      sf.innerHTML = '<option value="">Todas as etapas</option>' + state.stages.map(function (s) { return '<option value="' + esc(s.key) + '">' + esc(s.label) + "</option>"; }).join("");
      sf.value = cur;
      // Atualização automática (a cada 60 s): só redesenha se os dados mudaram, para as barras não reanimarem à toa.
      var assin = JSON.stringify([state.cards, state.stages, state.sync && state.sync.pending_commands, state.live]);
      if (!manual && state.assinatura === assin) { renderHeader(); carregarTarefas(); carregarDocCounts(); return; }
      state.assinatura = assin;
      renderAll(); prontoParaMostrar(); carregarEtapas(); carregarTarefas(); carregarDocCounts();
      if (!state.cardUrl) { state.cardUrl = true; try { var cu = new URLSearchParams(location.search).get("card"); if (cu && /^\d+$/.test(cu)) openDrawer(cu); } catch (_) {} }
      if (!state.jaPintou) { state.jaPintou = true; setTimeout(function () { document.documentElement.classList.add("ja-pintou"); }, 1500); }
      if (selectedId != null && $("#drawer").classList.contains("open") && !manual) { /* mantém o detalhe aberto sem recarregar o formulário */ }
      if (manual) toast("Atualizado " + F.dataHora(state.loadedAt) + " (Brasília)");
    } catch (e) {
      if (!e || e.status !== 401) { toast("Falha ao carregar: " + (e && e.message)); if (!state.k) estadoErro(e); }
    } finally { btn.disabled = false; }
  }

  // mesmo mapeamento de data-source.js (mapCard), sem precisar alterar aquele arquivo
  function mapCardLocal(c) {
    var tags = c.tags || [];
    return Object.assign({}, c, { priority: c.prioridade || c.priority || null,
      labels: tags.filter(function (t) { return String(t).indexOf("rotulo:") === 0; }).map(function (t) { return String(t).slice(7); }),
      solution: c.solution || "A definir", values: c.values || {}, active: c.active !== false && !c.deleted_at,
      stage_label: c.stage_label || c.stage, status_label: c.status_label || c.status, comments: c.comments || [] });
  }
  var lendo = false;
  async function refreshLight() {
    if (!state.live || lendo) return; lendo = true;
    try {
      var r = await Promise.all([KanzoData.tryFetch(KanzoData.API.cards + "?limit=500"), KanzoData.tryFetch(KanzoData.API.sync).catch(function () { return state.sync; })]);
      var lista = (Array.isArray(r[0]) ? r[0] : r[0].cards || []);
      var antigos = {}; state.cards.forEach(function (c) { antigos[c.id] = c; });
      state.cards = lista.map(function (c) { var m = KanzoData.mapCard ? KanzoData.mapCard(c) : mapCardLocal(c); var o = antigos[c.id]; if (o && o.comments && o.comments.length && !(m.comments || []).length) m.comments = o.comments; return m; });
      state.sync = r[1] || state.sync; state.loadedAt = new Date().toISOString();
      E.reconciliar(state.cards, state.sync);
      // Só redesenha se algo mudou de verdade (evita gráficos piscando a cada leitura).
      var assin = JSON.stringify([state.cards, state.stages, state.sync && state.sync.pending_commands, state.live]);
      if (state.assinatura === assin) { renderHeader(); carregarTarefas(); carregarDocCounts(); return; }
      state.assinatura = assin;
      renderAll(); if (!E.editando()) E.refreshTodos(); carregarEtapas(); carregarTarefas(); carregarDocCounts();
    } catch (_) {} finally { lendo = false; }
  }
  E = window.KanzoEditor.init({ getCards: function () { return state.cards; }, canWrite: canWrite, me: function () { return state.me; }, toast: toast,
    rerender: function () { if (state.k) renderAll(); }, refreshLight: refreshLight });
  /* 12/11: avisos de prazo (js/alertas.js) abrem o card por aqui. */
  window.KanzoAbrirCard = function (id) { openDrawer(id); };
  bindTips(); bindSections(); bindVisoes(); bindUI(); boot(false);
  /* Lote 8: a camada visual só "liga" as entradas com JS na tela; sem JS nada fica escondido. */
  document.documentElement.classList.add("lote8-on");
  montarRevelar();
  setInterval(function () { if (state.live && !document.hidden && !E.editando()) { if ($("#drawer").classList.contains("open") || E.ftAberta()) refreshLight(); else boot(false); } }, 60000);
  setInterval(function () { if (state.loadedAt) renderHeader(); }, 30000);
})();
