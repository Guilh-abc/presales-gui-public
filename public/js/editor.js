/* Edição inline, força-tarefa de qualidade, lote, atalhos, histórico e indicador de salvamento.
   Depende de KanzoFmt, KanzoFields, KanzoKPI, KanzoStore e KanzoData. byGui */
(function (g) {
  "use strict";
  var F = g.KanzoFmt, FL = g.KanzoFields, K = g.KanzoKPI;
  var esc = F.esc, doc = g.document;
  function $(s, el) { return (el || doc).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); }

  var opt = null, store = null, editing = null, clip = null, equipeCache = null, agRender = null, sugAtiva = -1;
  var ft = { open: false, tab: "todos", ativo: null, sel: {}, ordem: [], avancar: true, opener: null };
  var Q2F = { solucao: "solucao", valor: "tcv", prazo: "prazo", responsavel: "responsaveis" };
  var F2Q = { solucao: "solucao", tcv: "valor", prazo: "prazo", responsaveis: "responsavel" };
  var CHIP = { solucao: "Solução", valor: "Valor", prazo: "Prazo", responsavel: "Responsável" };
  var VAZIO = { solucao: "Definir a solução", responsaveis: "Adicionar responsável", prazo: "Definir prazo", tcv: "Registrar TCV", mrc: "Registrar MRC",
    otc: "Registrar OTC", saude: "Definir saúde", situacao: "Descrever a situação", proxima: "Definir a próxima ação" };
  var ESTADO = { local: "editando", saving: "Salvando…", retry: "Tentando de novo…", saved: "Salvo", applied: "Confirmado no app", error: "Não salvou", conflict: "Conflito" };
  var ESTADO_TIP = { saved: "Gravado no app (fonte oficial).",
    applied: "Confirmado: o app já devolve este valor.", retry: "A conexão falhou. Tentando de novo sozinho.", saving: "Gravando no app." };

  /* ---------------- dados ---------------- */
  function cards() { return opt.getCards() || []; }
  function raw(id) { var l = cards(); for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function eff(id) { var c = raw(id); return c ? store.efetivo(c) : null; }
  function ativos() { return cards().filter(function (c) { return c.active !== false && !c.deleted_at; }).map(function (c) { return store.efetivo(c); }); }
  function equipe() { return equipeCache || (equipeCache = FL.equipe(ativos())); }
  function porId() { var m = {}; cards().forEach(function (c) { m[String(c.id)] = c; }); return m; }
  function hojeISO() { return new Intl.DateTimeFormat("en-CA", { timeZone: F.TZ }).format(new Date()); }
  function somaDias(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fimDoMes(iso) { var d = new Date(iso + "T12:00:00Z"); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10); }
  function ultimaEdicao(id, key) { var h = store.historico().filter(function (x) { return String(x.cardId) === String(id) && x.campo === key; })[0]; return h; }
  function iniciais(n) { var p = String(n).trim().split(/\s+/); return ((p[0] || "").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase(); }

  /* ---------------- campo inline ---------------- */
  function exibir(c, key, v) {
    var f = FL.FIELDS[key];
    if (f.kind === "people") return v.length ? '<span class="people">' + v.map(function (p) { return '<span class="person"><i aria-hidden="true">' + esc(iniciais(p)) + "</i>" + esc(p) + "</span>"; }).join("") + "</span>" : "";
    if (key === "prazo" && v) {
      var pz = FL.prazo(c.description), d = F.diasAte(v), rel = d == null ? "" : d < 0 ? "venceu há " + (-d) + (d === -1 ? " dia" : " dias") : d === 0 ? "vence hoje" : "em " + d + (d === 1 ? " dia" : " dias");
      return esc(F.data(v)) + ' <span class="sub ' + (d != null && d < 0 && c.status !== "done" ? "bad" : "") + '">' + esc(rel) + " · " + esc(pz.fonte === "Kanzo" ? "app" : "Planner") + "</span>";
    }
    if (key === "saude" && v) { var cls = /risco|bloq/i.test(v) ? "bad" : /aten/i.test(v) ? "warn" : /prazo|ok|bem/i.test(v) ? "ok" : ""; return '<span class="tag ' + cls + '">' + esc(v) + "</span>"; }
    return esc(FL.texto(key, v));
  }
  function fieldHtml(c, key, o) {
    o = o || {};
    var f = FL.FIELDS[key], v = FL.ler(c, key), e = store.entrada(c.id, key), st = e ? e.state : "";
    var faltas = o.faltas || FL.faltas(c), falta = F2Q[key] && faltas.indexOf(F2Q[key]) >= 0;
    var pode = opt.canWrite(), ed = FL.editavel(c.description, key), vazio = f.kind === "people" ? !v.length : (v == null || v === "");
    var h = ultimaEdicao(c.id, key);
    var tip = f.hint + (h ? "\nÚltima edição: " + (h.by || "você") + " · " + F.dataHora(h.at) + " (Brasília)" : "");
    if (f.kind === "money" && !vazio) { var dn = FL.dinheiro(c.description, key); tip += "\nFonte: " + (dn.origem === "bloco" ? "valores registrados no painel" : "tabela da proposta") + (dn.linha ? "\n" + dn.linha : ""); }
    var id = "efl-" + esc(c.id) + "-" + key, cls = "ef" + (st ? " st-" + st : "") + (falta ? " attn" : "") + (o.wide || f.kind === "longtext" || f.kind === "people" ? " wide" : "");
    var stTxt = st && st !== "local" ? '<span class="ef-s" data-tip="' + esc(ESTADO_TIP[st] || e.error || "") + '">' + (st === "saving" || st === "retry" ? '<i class="spin" aria-hidden="true"></i>' : st === "saved" ? "✓ " : st === "applied" ? "✓✓ " : "") + esc(ESTADO[st]) + "</span>" : "";
    var corpo;
    if (pode && ed.ok) corpo = '<button type="button" class="ef-v' + (vazio ? " empty" : "") + '" aria-labelledby="' + id + '" aria-description="' + esc((vazio ? "vazio. " : "") + "Enter para editar") + '" data-tip="' + esc(tip) + '">' +
      (vazio ? '<span class="ph"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + esc(VAZIO[key]) + "</span>" : exibir(c, key, v)) + "</button>";
    else corpo = '<div class="ef-v ro' + (vazio ? " empty" : "") + '" tabindex="0" aria-labelledby="' + id + '" data-tip="' + esc(!pode ? "Somente leitura." : (ed.motivo || tip)) + '">' + (vazio ? '<span class="ph">sem dado</span>' : exibir(c, key, v)) +
      (pode && !ed.ok ? ' <svg class="ico lock" viewBox="0 0 24 24" aria-label="só leitura"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' : "") + "</div>";
    var extra = "";
    if (st === "conflict") extra = '<div class="ef-box conflict" role="alert"><b>Mudou no app enquanto você editava (outra aba ou pessoa).</b><div>Salvo no app: <q>' + esc(FL.texto(key, e.server) || "vazio") + "</q></div><div>Seu: <q>" + esc(FL.texto(key, e.value) || "vazio") + '</q></div><div class="row"><button type="button" class="btn btn-sm btn-primary" data-ef-acao="meu">Manter o meu</button><button type="button" class="btn btn-sm" data-ef-acao="kanzo">Usar o salvo</button></div></div>';
    else if (st === "error") extra = '<div class="ef-box error" role="alert"><b>' + esc(e.error || "Não salvou.") + '</b><div>A tela mostra o valor salvo no app. Seu valor: <q>' + esc(FL.texto(key, e.value) || "vazio") + '</q></div><div class="row"><button type="button" class="btn btn-sm btn-primary" data-ef-acao="retry">Tentar de novo</button><button type="button" class="btn btn-sm" data-ef-acao="descartar">Descartar</button></div></div>';
    return '<div class="' + cls + '" data-ef="1" data-id="' + esc(c.id) + '" data-key="' + key + '"' + (o.wide ? ' data-wide="1"' : "") + '><div class="ef-h"><span class="ef-l" id="' + id + '">' + esc(f.label) + "</span>" +
      (falta ? '<span class="ef-flag">faltando</span>' : "") + stTxt + "</div>" + corpo + extra + "</div>";
  }
  function refreshCampos(id) {
    var c = eff(id); if (!c) return;
    var faltas = FL.faltas(c);
    $$('[data-ef][data-id="' + cssEsc(id) + '"]').forEach(function (el) {
      if (editing && editing.el === el) { atualizaEstadoEditando(el); return; }
      var tinhaFoco = el.contains(doc.activeElement);
      el.outerHTML = fieldHtml(c, el.getAttribute("data-key"), { faltas: faltas, wide: el.getAttribute("data-wide") === "1" });
      if (tinhaFoco) { var n = $('[data-ef][data-id="' + cssEsc(id) + '"][data-key="' + el.getAttribute("data-key") + '"] .ef-v'); if (n) n.focus(); }
    });
  }
  function atualizaEstadoEditando(el) {
    var e = store.entrada(editing.id, editing.key), s = $(".ef-h .ef-s", el);
    var txt = e && e.state !== "local" ? ESTADO[e.state] : "";
    if (!s && txt) { s = doc.createElement("span"); s.className = "ef-s"; $(".ef-h", el).appendChild(s); }
    if (s) s.textContent = txt;
    el.className = el.className.replace(/\bst-\w+/g, "").trim() + (e ? " st-" + e.state : "");
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* ---------------- editor ---------------- */
  function sugestoes(c, key, termo, tokens) {
    var f = FL.FIELDS[key], out = [];
    if (f.kind === "people") {
      var tem = (tokens || []).map(function (x) { return FL.semAcento(x).toLowerCase(); });
      return FL.buscar(equipe(), termo, "nome").filter(function (p) { return tem.indexOf(FL.semAcento(p.nome).toLowerCase()) < 0; }).slice(0, 7)
        .map(function (p) { return { valor: p.nome, meta: p.n ? p.n + (p.n === 1 ? " card" : " cards") : "criou " + p.criou + " card(s)" }; });
    }
    if (key === "solucao") {
      var texto = c.title + " " + c.description;
      K.FAMILIAS.forEach(function (fa) { if (fa.re.test(texto)) out.push({ valor: fa.label, meta: "citado no texto do card", sugestao: true }); });
    }
    if (key === "saude") f.options.forEach(function (o) { out.push({ valor: o, meta: "opção" }); });
    // Só a Solução reaproveita valores de outros projetos; textos livres (situação, próxima ação etc.) não sugerem nada de outros cards.
    if (key === "solucao" && (f.kind === "text" || f.kind === "longtext")) {
      FL.usados(ativos(), key, c.id).forEach(function (u) {
        if (out.some(function (x) { return x.valor === u.valor; })) return;
        out.push({ valor: u.valor, meta: u.cards.length > 1 ? "em " + u.cards.length + " projetos" : "copiar de " + u.cards[0].title });
      });
    }
    out = FL.buscar(out, termo, "valor");
    return out.slice(0, 7);
  }
  function editorHtml(c, key, v) {
    var f = FL.FIELDS[key], lab = "efl-" + esc(c.id) + "-" + key, sug = '<ul class="ef-sug" id="ef-sug" role="listbox" aria-label="Sugestões" hidden></ul>';
    var ajuda = '<div class="ef-help"><span><kbd>Enter</kbd> salva</span><span><kbd>Esc</kbd> cancela</span><span><kbd>Tab</kbd> próximo</span><span class="auto">salva sozinho ao parar de digitar</span></div>';
    var msg = '<div class="ef-msg" id="ef-msg" role="status" aria-live="polite"></div>';
    var combo = ' role="combobox" aria-autocomplete="list" aria-controls="ef-sug" aria-expanded="false" aria-labelledby="' + lab + '" aria-describedby="ef-msg"';
    if (f.kind === "people") return '<div class="ef-ed"><div class="tokens" id="ef-tokens">' + v.map(tokenHtml).join("") + '<input class="ef-in" id="ef-in" autocomplete="off" placeholder="' + (v.length ? "mais alguém?" : "Digite um nome da equipe") + '"' + combo + "></div>" + sug + msg + ajuda + "</div>";
    if (f.kind === "date") {
      var hoje = hojeISO();
      return '<div class="ef-ed"><input class="ef-in" id="ef-in" type="date" value="' + esc(v || "") + '" aria-labelledby="' + lab + '" aria-describedby="ef-msg"><div class="quick">' +
        [["+7 dias", somaDias(hoje, 7)], ["+15 dias", somaDias(hoje, 15)], ["+30 dias", somaDias(hoje, 30)], ["Fim do mês", fimDoMes(hoje)]].map(function (q) { return '<button type="button" class="chip sm" data-quick="' + q[1] + '">' + q[0] + "</button>"; }).join("") +
        (v ? '<button type="button" class="chip sm" data-quick="">Limpar</button>' : "") + "</div>" + msg + ajuda + "</div>";
    }
    var val = f.kind === "money" ? (v == null ? "" : String(v).replace(".", ",")) : (v || "");
    if (f.kind === "longtext") return '<div class="ef-ed"><textarea class="ef-in" id="ef-in" rows="2"' + combo + ">" + esc(val) + "</textarea>" + sug + msg + ajuda + "</div>";
    return '<div class="ef-ed"><input class="ef-in" id="ef-in" autocomplete="off"' + (f.kind === "money" ? ' inputmode="decimal" placeholder="ex.: 69.033,32 ou 69 mil"' : "") + ' value="' + esc(val) + '"' + combo + ">" + sug + msg + ajuda + "</div>";
  }
  function tokenHtml(p) { return '<span class="tok"><i aria-hidden="true">' + esc(iniciais(p)) + "</i>" + esc(p) + '<button type="button" class="tok-x" data-tok="' + esc(p) + '" aria-label="Remover ' + esc(p) + '">✕</button></span>'; }

  function startEdit(el, preset) {
    if (!el || !opt.canWrite()) return;
    var id = el.getAttribute("data-id"), key = el.getAttribute("data-key"), c = eff(id);
    if (!c || !FL.editavel(c.description, key).ok) return;
    if (editing) commit(true);
    var v = FL.ler(c, key);
    editing = { id: id, key: key, el: el, start: v, tokens: FL.FIELDS[key].kind === "people" ? v.slice() : null };
    el.classList.add("editing");
    var box = $(".ef-v", el); box.outerHTML = editorHtml(c, key, v);
    $$(".ef-box", el).forEach(function (b) { b.remove(); });
    var inp = $("#ef-in", el);
    if (preset != null) { if (editing.tokens) editing.tokens = FL.normaliza(key, preset); else inp.value = FL.FIELDS[key].kind === "money" && typeof preset === "number" ? String(preset).replace(".", ",") : preset; if (editing.tokens) $("#ef-tokens", el).innerHTML = editing.tokens.map(tokenHtml).join("") + inp.outerHTML; inp = $("#ef-in", el); onInput(); }
    inp.focus(); if (inp.select && FL.FIELDS[key].kind !== "people") inp.select();
    if (inp.tagName === "TEXTAREA") autoGrow(inp);
    validarAoVivo();
    if (FL.FIELDS[key].kind !== "date") mostrarSug();
  }
  function autoGrow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 220) + "px"; }
  function valorEditor() {
    if (!editing) return null;
    var inp = $("#ef-in", editing.el), f = FL.FIELDS[editing.key];
    if (f.kind === "people") { var extra = inp.value.trim(); return editing.tokens.concat(extra ? [extra] : []); }
    return inp.value;
  }
  function validarAoVivo() {
    if (!editing) return [];
    var v = valorEditor(), c = eff(editing.id), msgs = FL.validar(editing.key, v, { equipe: equipe(), hoje: hojeISO(), mrc: FL.get(c.description, "mrc") });
    var box = $("#ef-msg", editing.el);
    if (box) box.innerHTML = msgs.map(function (m) { return '<span class="m ' + m.nivel + '">' + esc(m.msg) + "</span>"; }).join("");
    editing.el.classList.toggle("invalid", msgs.some(function (m) { return m.nivel === "erro"; }));
    return msgs;
  }
  function podeGravar() { return !validarAoVivo().some(function (m) { return m.nivel === "erro"; }); }
  function onInput() {
    if (!editing) return;
    var inp = $("#ef-in", editing.el); if (inp && inp.tagName === "TEXTAREA") autoGrow(inp);
    if (FL.FIELDS[editing.key].kind !== "date") mostrarSug();
    if (!podeGravar()) return;
    if (FL.FIELDS[editing.key].kind === "people") return; // tokens salvam ao entrar/sair
    try { store.edit(raw(editing.id), editing.key, valorEditor()); } catch (e) { opt.toast(e.message); }
  }
  function mostrarSug() {
    var ul = $("#ef-sug", editing && editing.el); if (!ul) return;
    var inp = $("#ef-in", editing.el), c = eff(editing.id);
    var termo = FL.FIELDS[editing.key].kind === "people" ? inp.value : (inp.value === FL.texto(editing.key, editing.start) ? "" : inp.value);
    var l = sugestoes(c, editing.key, termo, editing.tokens);
    if (FL.FIELDS[editing.key].kind !== "people") l = l.filter(function (s) { return s.valor !== inp.value; });
    sugAtiva = -1;
    ul.innerHTML = l.map(function (s, i) { return '<li role="option" id="ef-opt-' + i + '" aria-selected="false" data-sug="' + esc(s.valor) + '"' + (s.sugestao ? ' class="sg"' : "") + "><span>" + esc(s.valor) + "</span><small>" + esc(s.meta || "") + "</small></li>"; }).join("");
    ul.hidden = !l.length; inp.setAttribute("aria-expanded", String(!!l.length)); inp.removeAttribute("aria-activedescendant");
  }
  function moverSug(d) {
    var ul = $("#ef-sug", editing.el); if (!ul || ul.hidden) return false;
    var it = $$("li", ul); if (!it.length) return false;
    sugAtiva = (sugAtiva + d + it.length) % it.length;
    it.forEach(function (li, i) { li.setAttribute("aria-selected", String(i === sugAtiva)); });
    $("#ef-in", editing.el).setAttribute("aria-activedescendant", "ef-opt-" + sugAtiva);
    it[sugAtiva].scrollIntoView({ block: "nearest" });
    return true;
  }
  function escolherSug(valor) {
    if (!editing) return;
    var inp = $("#ef-in", editing.el);
    if (editing.tokens) { editing.tokens.push(valor); inp.value = ""; renderTokens(); salvarTokens(); mostrarSug(); validarAoVivo(); inp.focus(); return; }
    inp.value = valor; onInput(); commit();
  }
  function renderTokens() {
    var box = $("#ef-tokens", editing.el), inp = $("#ef-in", editing.el), val = inp.value;
    $$(".tok", box).forEach(function (t) { t.remove(); });
    editing.tokens.forEach(function (p) { inp.insertAdjacentHTML("beforebegin", tokenHtml(p)); });
    inp.placeholder = editing.tokens.length ? "mais alguém?" : "Digite um nome da equipe"; inp.value = val;
  }
  function salvarTokens() { try { store.edit(raw(editing.id), editing.key, editing.tokens.slice()); } catch (e) { opt.toast(e.message); } }
  function commit(silencioso, depois) {
    if (!editing) return true;
    if (!podeGravar()) { editing.el.classList.remove("shake"); void editing.el.offsetWidth; editing.el.classList.add("shake"); return false; }
    var ed = editing, v = valorEditor();
    editing = null;
    try { store.edit(raw(ed.id), ed.key, v, { imediato: true }); } catch (e) { if (!silencioso) opt.toast(e.message); }
    fecharEditor(ed, depois);
    return true;
  }
  function cancel() {
    if (!editing) return;
    var ed = editing; editing = null;
    try { store.edit(raw(ed.id), ed.key, ed.start, { imediato: true }); } catch (_) {}
    fecharEditor(ed);
  }
  function fecharEditor(ed, depois) {
    var c = eff(ed.id), el = ed.el;
    if (c && doc.contains(el)) {
      el.outerHTML = fieldHtml(c, ed.key, { wide: el.getAttribute("data-wide") === "1" });
      if (!depois) { var b = $('[data-ef][data-id="' + cssEsc(ed.id) + '"][data-key="' + ed.key + '"] .ef-v'); if (b) b.focus(); }
    }
    var novo = $('[data-ef][data-id="' + cssEsc(ed.id) + '"][data-key="' + ed.key + '"]');
    if (novo) novo.classList.add("flash");
    if (depois) depois();
  }
  function proximoCampo(el, dir) {
    var scope = el.closest("[data-ef-scope]") || el.parentNode, all = $$("[data-ef]", scope).filter(function (x) { return $("button.ef-v", x); });
    var i = all.indexOf(el); var n = all[i + (dir || 1)];
    return n || null;
  }

  /* ---------------- eventos ---------------- */
  function bind() {
    doc.addEventListener("click", function (e) {
      var a = e.target.closest("[data-ef-acao]");
      if (a) { var box = a.closest("[data-ef]"), id = box.getAttribute("data-id"), key = box.getAttribute("data-key"), acao = a.getAttribute("data-ef-acao");
        if (acao === "meu" || acao === "kanzo") store.resolver(raw(id), key, acao);
        else if (acao === "retry") store.tentarDeNovo(id);
        else if (acao === "descartar") store.descartar(id, key);
        refreshCampos(id); return; }
      var v = e.target.closest("[data-ef] button.ef-v"); if (v) { startEdit(v.closest("[data-ef]")); return; }
      var s = e.target.closest("#ef-sug li"); if (s) { e.preventDefault(); escolherSug(s.getAttribute("data-sug")); return; }
      var tx = e.target.closest(".tok-x"); if (tx && editing) { var n = tx.getAttribute("data-tok"); editing.tokens = editing.tokens.filter(function (p) { return p !== n; }); renderTokens(); salvarTokens(); validarAoVivo(); $("#ef-in", editing.el).focus(); return; }
      var q = e.target.closest("[data-quick]"); if (q && editing) { var inp = $("#ef-in", editing.el); inp.value = q.getAttribute("data-quick"); onInput(); commit(); return; }
      if (editing && !e.target.closest(".ef.editing")) commit(true);
    });
    doc.addEventListener("mousedown", function (e) { if (e.target.closest("#ef-sug li, [data-quick], .tok-x")) e.preventDefault(); });
    doc.addEventListener("input", function (e) { if (editing && e.target.id === "ef-in") onInput(); });
    doc.addEventListener("change", function (e) { if (editing && e.target.id === "ef-in" && e.target.type === "date") onInput(); });
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("focusout", function (e) {
      if (!editing || !editing.el.contains(e.target)) return;
      setTimeout(function () { if (editing && !editing.el.contains(doc.activeElement) && doc.activeElement !== doc.body) commit(true); }, 120);
    });
    g.addEventListener("online", function () { store.pendencias().forEach(function (p) { if (p.state === "error") store.tentarDeNovo(p.cardId); }); opt.toast("Conexão de volta. Reenviando o que faltou."); });
    g.addEventListener("beforeunload", function (e) {
      var r = store.resumo(); if (editing) commit(true);
      if (r.local || r.saving || r.retry) { store.flush(); e.preventDefault(); e.returnValue = ""; }
    });
  }
  function emCampoDeTexto(t) { return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
  function onKey(e) {
    if (editing && e.target.id === "ef-in") {
      var f = FL.FIELDS[editing.key], inp = e.target;
      if (e.key === "ArrowDown") { if (moverSug(1)) e.preventDefault(); return; }
      if (e.key === "ArrowUp") { if (moverSug(-1)) e.preventDefault(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); var ul = $("#ef-sug", editing.el); if (ul && !ul.hidden && sugAtiva >= 0) { ul.hidden = true; sugAtiva = -1; return; } cancel(); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        var li = sugAtiva >= 0 && $("#ef-opt-" + sugAtiva, editing.el);
        if (li) { escolherSug(li.getAttribute("data-sug")); return; }
        if (f.kind === "people" && inp.value.trim()) { editing.tokens.push(inp.value.trim()); inp.value = ""; renderTokens(); salvarTokens(); mostrarSug(); validarAoVivo(); return; }
        commit(); return;
      }
      if (e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        var el = editing.el, prox = proximoCampo(el, e.shiftKey ? -1 : 1), ed = editing;
        if (commit(true, function () {})) {
          var alvo = prox && $('[data-ef][data-id="' + cssEsc(prox.getAttribute("data-id")) + '"][data-key="' + prox.getAttribute("data-key") + '"]');
          if (alvo) startEdit(alvo); else { var b = $('[data-ef][data-id="' + cssEsc(ed.id) + '"][data-key="' + ed.key + '"] .ef-v'); if (b) b.focus(); }
        }
        return;
      }
      if (f.kind === "people" && e.key === "Backspace" && !inp.value && editing.tokens.length) { editing.tokens.pop(); renderTokens(); salvarTokens(); validarAoVivo(); e.preventDefault(); return; }
      if (f.kind === "people" && e.key === "," ) { e.preventDefault(); if (inp.value.trim()) { editing.tokens.push(inp.value.trim()); inp.value = ""; renderTokens(); salvarTokens(); mostrarSug(); } return; }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.key === "z" || e.key === "Z") && !emCampoDeTexto(e.target) && (ft.open || $("#drawer.open"))) { e.preventDefault(); desfazerUltimo(); }
      return;
    }
    if (emCampoDeTexto(e.target)) return;
    var ef = e.target.closest && e.target.closest("[data-ef]");
    if (ef && (e.key === "e" || e.key === "F2")) { e.preventDefault(); startEdit(ef); return; }
    if (ef && e.key === "c") { var c = eff(ef.getAttribute("data-id")), k = ef.getAttribute("data-key"); clip = { key: k, valor: FL.ler(c, k) }; opt.toast("Copiado: " + FL.FIELDS[k].label + " = " + (FL.texto(k, clip.valor) || "vazio") + ". Use v em outro projeto."); e.preventDefault(); return; }
    if (ef && e.key === "v" && clip) { e.preventDefault(); if (ef.getAttribute("data-key") !== clip.key) { opt.toast("O valor copiado é de " + FL.FIELDS[clip.key].label + "."); return; } startEdit(ef, clip.valor); return; }
    if (ft.open) return ftKey(e);
    if (e.key === "?" ) { e.preventDefault(); atalhos(); }
  }

  /* ---------------- desfazer e histórico ---------------- */
  function desfazerUltimo() {
    var h = store.historico().filter(function (x) { return x.origem !== "desfazer"; })[0] || store.historico()[0];
    if (!h) { opt.toast("Nada para desfazer."); return; }
    var n = store.desfazer(h.id, porId(), !!h.lote);
    opt.toast(n ? "Desfeito: " + FL.FIELDS[h.campo].label + (h.lote ? " em " + n + " projetos" : " em " + (h.titulo || "projeto")) : "Já estava assim.");
  }
  function histHtml() {
    var h = store.historico();
    if (!h.length) return '<div class="empty-s"><b>Nenhuma edição ainda</b><span>As últimas 15 edições feitas neste navegador aparecem aqui, com desfazer.</span></div>';
    return '<ul class="hist">' + h.map(function (x) {
      return '<li><div class="h-t"><b>' + esc(FL.FIELDS[x.campo].label) + "</b> · " + esc(x.titulo || ("card " + x.cardId)) + (x.lote ? ' <span class="tag dim">lote</span>' : "") + (x.origem === "desfazer" ? ' <span class="tag dim">desfazer</span>' : "") + '</div><div class="h-d"><s>' + esc(FL.texto(x.campo, x.antes) || "vazio") + "</s> → " + esc(FL.texto(x.campo, x.depois) || "vazio") +
        '</div><div class="h-m">' + esc((x.by || "você") + " · " + F.relativo(x.at) + " · " + F.dataHora(x.at)) + '</div><button type="button" class="btn btn-sm" data-undo="' + x.id + '">Desfazer</button></li>';
    }).join("") + "</ul>";
  }
  function abrirHistorico(anchor) {
    var pop = $("#hist-pop");
    if (!pop) { pop = doc.createElement("div"); pop.id = "hist-pop"; pop.className = "pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Histórico de edições"); doc.body.appendChild(pop);
      pop.addEventListener("click", function (e) { var b = e.target.closest("[data-undo]"); if (b) { var h = store.historico().filter(function (x) { return x.id === +b.getAttribute("data-undo"); })[0]; var n = store.desfazer(+b.getAttribute("data-undo"), porId(), false); opt.toast(n ? "Desfeito." : "Já estava assim."); pop.innerHTML = popHead() + histHtml(); } if (e.target.closest("[data-pop-x]")) fecharPop(); });
      pop.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); fecharPop(); } }); }
    pop.innerHTML = popHead() + histHtml(); pop.hidden = false; pop._anchor = anchor;
    var r = anchor.getBoundingClientRect(); pop.style.top = Math.min(r.bottom + 8, g.innerHeight - 120) + "px"; pop.style.right = Math.max(8, g.innerWidth - r.right) + "px";
    var x = $("[data-pop-x]", pop); if (x) x.focus();
  }
  function popHead() { return '<div class="pop-h"><b>Últimas edições</b><span class="meta">neste navegador · até 15</span><button type="button" class="btn btn-ghost btn-sm" data-pop-x aria-label="Fechar histórico">✕</button></div>'; }
  function fecharPop() { var p = $("#hist-pop"); if (p && !p.hidden) { p.hidden = true; if (p._anchor) p._anchor.focus(); } }

  /* ---------------- indicador global ---------------- */
  function indicador() {
    var el = $("#save-ind"); if (!el) return;
    var r = store.resumo(), t, cls, tip;
    if (r.error || r.conflict) { cls = "bad"; t = (r.error + r.conflict) + (r.error + r.conflict === 1 ? " precisa de você" : " precisam de você"); tip = "Alterações com erro ou conflito. Clique para ver."; }
    else if (r.saving || r.retry || r.local) { cls = "busy"; t = r.retry ? "Tentando de novo…" : "Salvando…"; tip = "Gravando no app."; }
    else if (r.saved) { cls = "live"; t = "Salvo"; tip = r.saved + " alteração(ões) gravada(s) no app. Nada se perde se você fechar a página."; }
    else if (r.applied) { cls = "live"; t = "Tudo salvo"; tip = "O app confirmou as últimas alterações."; }
    else { cls = ""; t = "Tudo salvo"; tip = "Nenhuma alteração pendente."; }
    el.className = "pill save " + cls; $(".t", el).textContent = t; el.setAttribute("data-tip", tip + "\nClique para ver o histórico (Ctrl+Z desfaz a última).");
    var sr = $("#sr-status"); if (sr && sr._last !== t) { sr._last = t; sr.textContent = t; }
  }

  /* ---------------- força-tarefa ---------------- */
  function faltasDe(c) { return FL.faltas(c); }
  function sessao() {
    var s = null; try { s = JSON.parse(g.sessionStorage.getItem("kanzo.ft.sessao") || "null"); } catch (_) {}
    if (!s || !s.ids) { s = { ids: ativos().filter(function (c) { return faltasDe(c).length; }).map(function (c) { return String(c.id); }), at: Date.now() }; try { g.sessionStorage.setItem("kanzo.ft.sessao", JSON.stringify(s)); } catch (_) {} }
    return s;
  }
  function contagens(list) {
    var n = { todos: 0, solucao: 0, valor: 0, prazo: 0, responsavel: 0 };
    list.forEach(function (c) { var f = faltasDe(c); if (f.length) n.todos++; f.forEach(function (x) { n[x]++; }); });
    return n;
  }
  function calcOrdem() {
    var l = ativos().filter(function (c) { var f = faltasDe(c); return ft.tab === "todos" ? f.length : f.indexOf(ft.tab) >= 0; });
    l.sort(function (a, b) { return (a.status === "done") - (b.status === "done") || faltasDe(b).length - faltasDe(a).length || String(a.title).localeCompare(String(b.title), "pt-BR"); });
    ft.ordem = l.map(function (c) { return String(c.id); });
  }
  function abrirForca(tab) {
    if (!opt.canWrite()) { opt.toast("A força-tarefa precisa de acesso de edição (admin) e da API no ar."); return; }
    ft.opener = doc.activeElement; ft.open = true; ft.tab = tab || "todos"; ft.sel = {};
    var box = $("#ft"); box.hidden = false; doc.body.classList.add("ft-on");
    calcOrdem(); ft.ativo = ft.ordem[0] || null; renderFt(); abrirCardFt(ft.ativo, true);
  }
  function fecharForca() {
    if (editing) commit(true);
    ft.open = false; $("#ft").hidden = true; doc.body.classList.remove("ft-on");
    store.flush(); opt.rerender();
    if (ft.opener && doc.contains(ft.opener)) ft.opener.focus();
  }
  function renderFt() {
    if (!ft.open) return;
    var all = ativos(), n = contagens(all), s = sessao();
    var byId = {}; all.forEach(function (c) { byId[String(c.id)] = c; });
    var feitos = s.ids.filter(function (id) { return byId[id] && !faltasDe(byId[id]).length; }).length, total = s.ids.length;
    $("#ft-prog-t").innerHTML = "<b>" + feitos + "</b> de " + total + " projetos completos nesta sessão" + (total ? " · " + Math.round(feitos / total * 100) + "%" : "");
    $("#ft-prog i").style.transform = "scaleX(" + (total ? feitos / total : 0) + ")";
    $("#ft-prog").setAttribute("aria-valuenow", String(feitos)); $("#ft-prog").setAttribute("aria-valuemax", String(total));
    $("#ft-tabs").innerHTML = [["todos", "Tudo que falta"], ["solucao", "Solução a definir"], ["valor", "Sem valor registrado"], ["prazo", "Abertos sem prazo"], ["responsavel", "Sem responsável"]].map(function (t, i) {
      return '<button type="button" role="tab" class="ft-tab q-' + t[0] + '" aria-selected="' + (ft.tab === t[0]) + '" data-ft-tab="' + t[0] + '"><span>' + t[1] + '</span><b class="cnt' + (n[t[0]] ? "" : " zero") + '">' + n[t[0]] + '</b><kbd>' + i + "</kbd></button>";
    }).join("");
    var list = $("#ft-list");
    if (!ft.ordem.length) list.innerHTML = '<div class="empty-s big"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><b>Nada faltando aqui</b><span>Todos os projetos estão completos neste indicador. Escolha outro acima.</span></div>';
    else list.innerHTML = ft.ordem.map(function (id) {
      var c = byId[id]; if (!c) return "";
      var f = faltasDe(c), done = !f.length, sel = !!ft.sel[id];
      return '<div class="ftr' + (done ? " done" : "") + (String(ft.ativo) === id ? " on" : "") + (sel ? " picked" : "") + '" tabindex="' + (String(ft.ativo) === id ? "0" : "-1") + '" role="option" id="ftr-' + esc(id) + '" aria-selected="' + (String(ft.ativo) === id) + '" data-ftid="' + esc(id) + '">' +
        '<label class="ck" data-tip="Selecionar para preencher em lote (x)"><input type="checkbox" data-ftsel="' + esc(id) + '"' + (sel ? " checked" : "") + ' aria-label="Selecionar ' + esc(c.title) + ' para lote"><span></span></label>' +
        '<span class="ftr-b"><span class="ftr-t">' + esc(c.title) + '</span><span class="ftr-m">' + esc((c.stage_label || c.stage || "sem etapa") + " · " + F.statusLabel(c.status)) + "</span></span>" +
        '<span class="ftr-c">' + (done ? '<span class="ok-c">✓ completo</span>' : f.map(function (x) { return '<span class="qc q-' + x + '">' + CHIP[x] + "</span>"; }).join("")) + "</span></div>";
    }).join("");
    var sels = Object.keys(ft.sel).filter(function (k) { return ft.sel[k]; });
    var bar = $("#ft-batch"); bar.hidden = !sels.length;
    if (sels.length) $("#ft-batch-n").textContent = sels.length + (sels.length === 1 ? " selecionado" : " selecionados");
    var ativoEl = $("#ftr-" + cssEsc(ft.ativo)); if (ativoEl) { list.setAttribute("aria-activedescendant", ativoEl.id); }
    indicador();
  }
  function abrirCardFt(id, focarFalta) {
    if (editing) commit(true);
    ft.ativo = id;
    $$("#ft-list .ftr").forEach(function (r) { var on = r.getAttribute("data-ftid") === String(id); r.classList.toggle("on", on); r.setAttribute("aria-selected", String(on)); r.tabIndex = on ? 0 : -1; if (on) r.scrollIntoView({ block: "nearest" }); });
    var pane = $("#ft-card");
    if (!id || !eff(id)) { pane.innerHTML = '<div class="empty-s big"><b>Escolha um projeto</b><span>Use j e k para navegar, ou clique na lista.</span></div>'; return; }
    var c = eff(id), f = faltasDe(c), notas = notasDe(c.description);
    var ordem = ["solucao", "tcv", "prazo", "responsaveis"], resto = ["saude", "situacao", "proxima", "mrc", "otc"];
    pane.innerHTML = '<div class="ftc-h"><div><h3 id="ftc-t">' + esc(c.title) + '</h3><div class="meta">' + esc((c.stage_label || c.stage || "sem etapa") + " · " + F.statusLabel(c.status) + " · atualizado " + F.relativo(c.updated_at)) + '</div></div>' +
      '<div class="ftc-falta" id="ftc-falta">' + faltaResumo(f) + '</div></div>' +
      '<div class="efs" data-ef-scope="1" id="ftc-campos">' + ordem.map(function (k) { return fieldHtml(c, k, { faltas: f, wide: k === "solucao" || k === "responsaveis" }); }).join("") + "</div>" +
      '<details class="blk" open><summary>Saúde, situação e próxima ação<span class="meta">opcional</span></summary><div class="efs" data-ef-scope="1">' + resto.map(function (k) { return fieldHtml(c, k, { faltas: f }); }).join("") + "</div></details>" +
      '<details class="blk"' + (f.indexOf("solucao") >= 0 || f.indexOf("valor") >= 0 ? " open" : "") + '><summary>Contexto do card<span class="meta">para preencher sem sair daqui</span></summary><div class="ctx">' +
      (notas ? '<p class="notas">' + esc(notas) + "</p>" : '<p class="muted">O card não tem notas.</p>') + "</div></details>";
    if (focarFalta) { var alvo = f.length ? $('#ftc-campos [data-key="' + Q2F[ft.tab !== "todos" && f.indexOf(ft.tab) >= 0 ? ft.tab : f[0]] + '"]') : null; if (alvo && $("button.ef-v", alvo)) startEdit(alvo); else { var r = $("#ftr-" + cssEsc(id)); if (r) r.focus(); } }
  }
  function faltaResumo(f) { return f.length ? '<span class="lbl">Faltando</span>' + f.map(function (x) { return '<span class="qc q-' + x + '">' + CHIP[x] + "</span>"; }).join("") : '<span class="ok-c big">✓ Projeto completo</span>'; }
  function notasDe(desc) {
    var ls = String(desc || "").split("\n"), out = [], ini = -1;
    for (var i = 0; i < ls.length; i++) if (/^\s*\*\*(Notas|Descri[cç][aã]o|Meta|Status)/i.test(ls[i])) { ini = i; break; }
    if (ini < 0) return "";
    out = ls.slice(ini).join("\n").replace(/\*\*/g, "").trim();
    return out.length > 900 ? out.slice(0, 900) + "…" : out;
  }
  function moverFt(d) {
    if (!ft.ordem.length) return;
    var i = ft.ordem.indexOf(String(ft.ativo)); i = Math.max(0, Math.min(ft.ordem.length - 1, (i < 0 ? 0 : i + d)));
    abrirCardFt(ft.ordem[i], false); var r = $("#ftr-" + cssEsc(ft.ordem[i])); if (r) r.focus();
  }
  function proximoIncompleto() {
    var i = ft.ordem.indexOf(String(ft.ativo));
    for (var k = 1; k <= ft.ordem.length; k++) { var id = ft.ordem[(i + k) % ft.ordem.length], c = eff(id); if (c && faltasDe(c).filter(function (x) { return ft.tab === "todos" || x === ft.tab; }).length) return id; }
    return null;
  }
  function ftKey(e) {
    var k = e.key;
    if (k === "Escape") { if (!$("#hist-pop") || $("#hist-pop").hidden) { e.preventDefault(); e.stopPropagation(); fecharForca(); } return; }
    if (k === "j" || k === "ArrowDown") { e.preventDefault(); moverFt(1); return; }
    if (k === "k" || k === "ArrowUp") { e.preventDefault(); moverFt(-1); return; }
    if (k === "e" || k === "Enter") {
      if (e.target.closest && e.target.closest("button, a, summary, input, label") && !e.target.closest(".ftr")) return;
      e.preventDefault(); var c = eff(ft.ativo); if (!c) return; var f = faltasDe(c);
      var alvo = $('#ftc-campos [data-key="' + Q2F[f[0] || "solucao"] + '"]'); if (alvo) startEdit(alvo); return; }
    if (k === "n") { e.preventDefault(); var nx = proximoIncompleto(); if (nx) abrirCardFt(nx, true); else opt.toast("Nada faltando neste indicador."); return; }
    if (k === "x") { e.preventDefault(); if (ft.ativo) { ft.sel[ft.ativo] = !ft.sel[ft.ativo]; renderFt(); } return; }
    if (k === "s") { e.preventDefault(); store.flush(); opt.toast("Salvando tudo agora."); return; }
    if (k === "u") { e.preventDefault(); desfazerUltimo(); return; }
    if (k === "h") { e.preventDefault(); abrirHistorico($("#ft-hist")); return; }
    if (/^[0-4]$/.test(k)) { e.preventDefault(); trocarTab(["todos", "solucao", "valor", "prazo", "responsavel"][+k]); return; }
    if (k === "?") { e.preventDefault(); atalhos(); }
  }
  function trocarTab(t) { ft.tab = t; calcOrdem(); if (ft.ordem.indexOf(String(ft.ativo)) < 0) ft.ativo = ft.ordem[0] || null; renderFt(); abrirCardFt(ft.ativo, true); }
  function atalhos() {
    var d = $("#kbd-help"); d.hidden = !d.hidden;
    if (!d.hidden) $("button", d).focus();
  }
  function bindFt() {
    var box = $("#ft");
    box.addEventListener("click", function (e) {
      var t = e.target.closest("[data-ft-tab]"); if (t) { trocarTab(t.getAttribute("data-ft-tab")); return; }
      var ck = e.target.closest("[data-ftsel]"); if (ck) { ft.sel[ck.getAttribute("data-ftsel")] = ck.checked; renderFt(); return; }
      if (e.target.closest(".ck")) return;
      var r = e.target.closest(".ftr"); if (r) { abrirCardFt(r.getAttribute("data-ftid"), true); return; }
    });
    $("#ft-close").addEventListener("click", fecharForca);
    $("#ft-hist").addEventListener("click", function (e) { abrirHistorico(e.currentTarget); });
    $("#ft-kbd").addEventListener("click", atalhos);
    $("#kbd-help").addEventListener("click", function (e) { if (e.target.closest("[data-kbd-x]") || e.target === e.currentTarget) $("#kbd-help").hidden = true; });
    $("#ft-avancar").addEventListener("change", function (e) { ft.avancar = e.target.checked; });
    $("#ft-sel-todos").addEventListener("click", function () { ft.ordem.forEach(function (id) { var c = eff(id); if (c && faltasDe(c).length) ft.sel[id] = true; }); renderFt(); });
    $("#ft-batch-x").addEventListener("click", function () { ft.sel = {}; renderFt(); });
    $("#ft-batch-campo").addEventListener("change", loteCampo);
    $("#ft-batch-go").addEventListener("click", aplicarLote);
    $("#ft-batch-v").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); aplicarLote(); } });
    box.addEventListener("keydown", function (e) { // trava o foco dentro do diálogo
      if (e.key !== "Tab" || editing) return;
      var f = $$('button:not([disabled]),input,select,textarea,summary,[tabindex="0"]', box).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    loteCampo();
  }
  function loteCampo() {
    var k = $("#ft-batch-campo").value, inp = $("#ft-batch-v"), dl = $("#ft-batch-dl"), f = FL.FIELDS[k];
    inp.type = f.kind === "date" ? "date" : "text"; inp.value = "";
    inp.placeholder = f.kind === "people" ? "Nome da equipe (adiciona aos atuais)" : f.kind === "money" ? "ex.: 69 mil" : "Valor para todos";
    var ops = f.kind === "people" ? equipe().map(function (p) { return p.nome; }) : (k === "saude" ? f.options : []).concat(FL.usados(ativos(), k).map(function (u) { return String(u.valor); }));
    dl.innerHTML = ops.slice(0, 30).map(function (o) { return '<option value="' + esc(o) + '">'; }).join("");
    $("#ft-batch-modo").hidden = f.kind !== "people";
  }
  function aplicarLote() {
    var k = $("#ft-batch-campo").value, bruto = $("#ft-batch-v").value, f = FL.FIELDS[k];
    var ids = Object.keys(ft.sel).filter(function (x) { return ft.sel[x]; });
    if (!ids.length) return;
    var msgs = FL.validar(k, bruto, { equipe: equipe(), hoje: hojeISO() });
    if (!String(bruto).trim()) { opt.toast("Digite o valor para aplicar."); $("#ft-batch-v").focus(); return; }
    if (msgs.some(function (m) { return m.nivel === "erro"; })) { opt.toast(msgs[0].msg); return; }
    var lote = "L" + Date.now(), feitos = 0, pulados = 0, substituir = $("#ft-batch-sub") && $("#ft-batch-sub").checked;
    ids.forEach(function (id) {
      var c = raw(id); if (!c) return;
      var e = store.efetivo(c);
      if (!FL.editavel(e.description, k).ok) { pulados++; return; }
      var v = bruto;
      if (f.kind === "people" && !substituir) v = FL.get(e.description, k).concat(FL.normaliza(k, bruto));
      try { if (store.edit(c, k, v, { imediato: true, origem: "lote", lote: lote })) feitos++; } catch (_) { pulados++; }
    });
    ft.sel = {}; renderFt(); abrirCardFt(ft.ativo, false);
    opt.toast(f.label + " preenchido em " + feitos + (feitos === 1 ? " projeto" : " projetos") + (pulados ? " · " + pulados + " pulado(s): valor vem da proposta" : ""), feitos ? { label: "Desfazer lote", fn: function () { var h = store.historico().filter(function (x) { return x.lote === lote; })[0]; if (h) store.desfazer(h.id, porId(), true); else setTimeout(function () { var h2 = store.historico().filter(function (x) { return x.lote === lote; })[0]; if (h2) store.desfazer(h2.id, porId(), true); }, 1500); } } : null);
  }

  /* ---------------- ciclo ---------------- */
  function onChange(ev) {
    equipeCache = null;
    if (ev.id) refreshCampos(ev.id);
    else $$("[data-ef]").forEach(function (el) { if (!editing || editing.el !== el) refreshCampos(el.getAttribute("data-id")); });
    indicador();
    if (ev.tipo === "erro") opt.toast("Não salvou " + (ev.entrada ? FL.FIELDS[ev.campo].label : "a alteração") + ". O valor salvo no app voltou para a tela.", { label: "Tentar de novo", fn: function () { store.tentarDeNovo(ev.id); } });
    if (ev.tipo === "conflito") opt.toast("Conflito em " + FL.FIELDS[ev.campo].label + ": mudou no app enquanto você editava. Escolha qual valor fica.");
    if (ft.open && (ev.tipo === "editado" || ev.tipo === "salvo" || ev.tipo === "reconciliado" || ev.tipo === "cancelado" || ev.tipo === "descartado" || ev.tipo === "resolvido")) {
      renderFt();
      var c = eff(ft.ativo), fx = $("#ftc-falta"); if (c && fx) fx.innerHTML = faltaResumo(faltasDe(c));
      if (ev.tipo === "editado" && ft.avancar && c && String(ev.id) === String(ft.ativo) && !faltasDe(c).filter(function (x) { return ft.tab === "todos" || x === ft.tab; }).length) {
        var r = $("#ftr-" + cssEsc(ft.ativo)); if (r) r.classList.add("just");
        clearTimeout(ft._av); ft._av = setTimeout(function () { if (!editing && ft.open) { var nx = proximoIncompleto(); if (nx) abrirCardFt(nx, true); } }, 900);
      }
    }
    clearTimeout(agRender); agRender = setTimeout(function () { opt.rerender(); }, 220);
  }
  function init(o) {
    opt = o;
    store = g.KanzoStore.create({
      api: { get: function (id) { return g.KanzoData.tryFetch("/api/cards/" + encodeURIComponent(id)); }, patch: function (id, body) { return g.KanzoData.write("PATCH", "/api/cards/" + encodeURIComponent(id), body); } },
      storage: g.localStorage, autor: function () { var me = opt.me(); return (me && (me.nome || me.email)) || "você"; }, onChange: onChange
    });
    bind(); bindFt();
    var si = $("#save-ind"); if (si) si.addEventListener("click", function (e) { abrirHistorico(e.currentTarget); });
    setInterval(function () { store.limparAplicados(); if (store.resumo().saved && !doc.hidden) opt.refreshLight(); }, 6000);
    indicador();
    return api;
  }
  var api = {
    init: init, fieldHtml: function (c, k, o) { return fieldHtml(store.efetivo(c), k, o); }, efetivos: function (l) { return (l || []).map(function (c) { return store.efetivo(c); }); },
    reconciliar: function (cards, sync) { store.reconciliar(cards, sync); equipeCache = null; }, abrirForca: abrirForca, abrirHistorico: abrirHistorico, histHtml: histHtml,
    estado: function (id) { var p = store.pendencias().filter(function (x) { return String(x.cardId) === String(id); }); if (!p.length) return ""; if (p.some(function (x) { return x.state === "error" || x.state === "conflict"; })) return "error"; if (p.some(function (x) { return x.state === "saving" || x.state === "retry" || x.state === "local"; })) return "saving"; if (p.some(function (x) { return x.state === "saved"; })) return "saved"; return "applied"; },
    editando: function () { return !!editing; }, ftAberta: function () { return ft.open; }, renderFt: renderFt, contagens: function () { return contagens(ativos()); },
    temPendente: function (id) { return store.pendencias().some(function (x) { return String(x.cardId) === String(id) && x.state !== "applied"; }); },
    store: function () { return store; },
    refreshTodos: function () { var ids = {}; $$("[data-ef]").forEach(function (el) { ids[el.getAttribute("data-id")] = 1; }); Object.keys(ids).forEach(refreshCampos); if (ft.open) { renderFt(); var c = eff(ft.ativo), fx = $("#ftc-falta"); if (c && fx) fx.innerHTML = faltaResumo(faltasDe(c)); } indicador(); }
  };
  g.KanzoEditor = api;
})(window);
