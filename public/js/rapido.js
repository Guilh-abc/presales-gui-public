/* rapido.js — tela /rapido.html (feature 6). Dados do card só entram na tela via textContent (nunca como HTML).
   Fluxo: interpretar (local, nada vai à rede) → escolher card se ambíguo → confirmar → POST /api/rapido/confirm.
   Saúde/prazo: a descrição nova é montada com KanzoFields.set (mesmo formato do editor) + hash da descrição lida. */
(function (g) {
  "use strict";
  var R = g.KanzoRapido, FL = g.KanzoFields, d = g.document;
  var $ = function (id) { return d.getElementById(id); };
  var estado = { cards: [], prop: null, texto: "" };

  function el(tag, cls, txt) { var e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function mostra(id, sim) { $(id).hidden = !sim; }
  function erro(msg) { $("rp-erro").textContent = msg || ""; mostra("rp-erro", !!msg); }

  async function api(url, opts) {
    opts = opts || {};
    var h = { Accept: "application/json" };
    if (opts.method && opts.method !== "GET") { h["Content-Type"] = "application/json"; h["X-MCO"] = "1"; }
    var r = await fetch(url, { method: opts.method || "GET", headers: h, credentials: "same-origin", body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (r.status === 401) { g.location.replace("/login"); throw new Error("Entre para continuar."); }
    var j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok) { var e = new Error((j && (j.erro || j.error)) || ("HTTP " + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  async function sha256(txt) {
    var c = g.crypto && g.crypto.subtle; if (!c) throw new Error("Navegador sem crypto.subtle (precisa de HTTPS).");
    var b = await c.digest("SHA-256", new TextEncoder().encode(String(txt || "")));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  function dataHora(iso) {
    try { return new Intl.DateTimeFormat("pt-BR", { timeZone: R.TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch (_) { return iso || ""; }
  }

  async function statusMac() {
    try {
      var s = await api("/api/sync/status"), p = $("rp-mac");
      if (s.app_only) { p.className = "rp-mac on"; p.textContent = "Grava direto no app, na hora."; return; }
      p.className = "rp-mac " + (s.mac_online ? "on" : "off");
      p.textContent = s.mac_online ? "Mac online: aplica em segundos." : "Mac offline: fica na fila até o Mac voltar." + (s.message ? " " + s.message : "");
    } catch (e) { $("rp-mac").textContent = "Grava direto no app."; }
  }
  async function carregarCards() {
    var j = await api("/api/cards?limit=500");
    estado.cards = (j.cards || []).map(function (c) { return { id: c.id, title: c.title, stage: c.stage, status: c.status, description: c.description || "" }; });
  }
  var ROT_ST = { pending: "na fila", applied: "gravado no app", failed: "falhou", cancelled: "desfeito" };
  async function historico() {
    var ul = $("rp-hist"); ul.textContent = "";
    try {
      var j = await api("/api/rapido/history?limit=20");
      if (!j.history.length) { ul.appendChild(el("li", null, "Nenhum registro ainda.")); return; }
      j.history.forEach(function (h) {
        var li = el("li"), t = el("div", "txt");
        t.appendChild(el("span", null, h.raw_text));
        t.appendChild(el("small", null, dataHora(h.created_at) + " · " + (h.card_title || ("card " + h.card_id))));
        li.appendChild(t);
        li.appendChild(el("span", "rp-st " + h.status, ROT_ST[h.status] || h.status));
        if (h.pode_desfazer) {
          var b = el("button", "rp-btn rp-sec rp-mini", "Desfazer"); b.type = "button";
          b.addEventListener("click", function () { desfazer(h.id, b); });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
    } catch (e) { ul.appendChild(el("li", null, "Erro ao carregar o histórico: " + e.message)); }
  }
  async function desfazer(id, b) {
    b.disabled = true; erro("");
    try { await api("/api/rapido/" + id + "/undo", { method: "POST", body: {} }); await carregarCards(); }
    catch (e) { erro(e.message); }
    historico();
  }

  function limparResultado() { estado.prop = null; mostra("rp-candidatos", false); mostra("rp-confirma", false); erro(""); }
  function interpretar(cardId) {
    limparResultado();
    estado.texto = $("rp-texto").value.trim();
    var p = R.interpretar(estado.texto, estado.cards, { card_id: cardId });
    if (p.ambiguous) return candidatos(p);
    if (!p.ok) return erro(p.avisos[0] || "Não entendi.");
    estado.prop = p; confirmar(p);
  }
  function candidatos(p) {
    var ul = $("rp-cand-lista"); ul.textContent = "";
    p.candidatos.forEach(function (c) {
      var li = el("li"), b = el("button", "rp-opcao"); b.type = "button";
      b.appendChild(el("span", null, c.title));
      b.appendChild(el("small", null, (c.stage_label || "sem etapa") + " · " + (c.status || "")));
      b.addEventListener("click", function () { interpretar(c.id); });
      li.appendChild(b); ul.appendChild(li);
    });
    mostra("rp-candidatos", true);
  }
  function confirmar(p) {
    $("rp-conf-card").textContent = p.card_title;
    var r = $("rp-conf-resumo"), a = $("rp-conf-avisos"); r.textContent = ""; a.textContent = "";
    p.resumo.forEach(function (x) { r.appendChild(el("li", null, x)); });
    p.avisos.forEach(function (x) { a.appendChild(el("li", null, x)); });
    $("rp-fech").checked = false;
    if (p.fechamento) $("rp-fech-txt").textContent = "Confirmo: " + R.STAGE_LABEL[p.mudancas.stage];
    mostra("rp-fech-wrap", p.fechamento);
    mostra("rp-confirma", true);
    $("rp-confirmar").focus();
  }
  async function enviar() {
    var p = estado.prop; if (!p) return;
    if (p.fechamento && !$("rp-fech").checked) return erro("Marque a caixa para confirmar a mudança de fechamento.");
    var card = estado.cards.filter(function (c) { return c.id === p.card_id; })[0];
    if (!card) return erro("Card não encontrado; recarregue a página.");
    var body = { card_id: p.card_id, raw: p.raw, comentario: p.comentario, confirmar_fechamento: !!(p.fechamento && $("rp-fech").checked) };
    if (p.mudancas.stage) body.stage = p.mudancas.stage;
    try {
      var desc = card.description;
      if (p.mudancas.saude != null) desc = FL.set(desc, "saude", p.mudancas.saude);
      if (p.mudancas.prazo) desc = FL.set(desc, "prazo", p.mudancas.prazo);
      if (desc !== card.description) { body.description = desc; body.expect_description_sha256 = await sha256(card.description); }
    } catch (e) { return erro("Não consegui preparar a descrição: " + e.message); }
    var btn = $("rp-confirmar"); btn.disabled = true; btn.textContent = "Enviando…"; erro("");
    try {
      await api("/api/rapido/confirm", { method: "POST", body: body });
      $("rp-texto").value = ""; limparResultado();
      await carregarCards();
    } catch (e) {
      erro(e.status === 409 && e.body && e.body.error === "conflict" ? "O card mudou desde a leitura. Recarreguei; interprete de novo." : e.message);
      if (e.status === 409) await carregarCards();
    } finally { btn.disabled = false; btn.textContent = "Confirmar e gravar"; historico(); statusMac(); }
  }

  async function iniciar() {
    try {
      var me = await api("/api/me");
      if (!me.can_write) { mostra("rp-somente-admin", true); return; }
      mostra("rp-form", true);
      await carregarCards();
    } catch (e) { erro(e.message); mostra("rp-form", true); }
    statusMac(); historico();
    g.setInterval(statusMac, 30000);
  }

  $("rp-interpretar").addEventListener("click", function () { interpretar(); });
  $("rp-limpar").addEventListener("click", function () { $("rp-texto").value = ""; limparResultado(); $("rp-texto").focus(); });
  $("rp-editar").addEventListener("click", function () { limparResultado(); $("rp-texto").focus(); });
  $("rp-cancelar").addEventListener("click", function () { $("rp-texto").value = ""; limparResultado(); });
  $("rp-confirmar").addEventListener("click", enviar);
  /* Enter nunca grava; Ctrl/Cmd+Enter só INTERPRETA (a confirmação continua obrigatória). */
  $("rp-texto").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); interpretar(); } });
  iniciar();
})(window);
