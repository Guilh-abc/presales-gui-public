/* alertas.js — 12/11/2026: faixa única no topo só quando um prazo gravado entra na janela de 8 h (ou já venceu no mesmo dia, Brasília).
   Sem pilha de pendências ao abrir. Lê GET /api/alertas (só admin). Não recarrega o painel; atualiza a faixa a cada 2 min.
   Sem estilo inline (CSP): só classes de css/alertas.css. byGui */
(function () {
  "use strict";
  var POLL_MS = 2 * 60 * 1000;
  var KEY = "kanzo.alerta8h.fechados";
  var idsNaFaixa = {};
  var timer = null, buscando = false, ultimaAssinatura = "";

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function diaSP(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d || new Date()); }
  function mapaFechados() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function foiFechado(id) { var m = mapaFechados(); return (m[diaSP()] || []).indexOf(id) >= 0; }
  function marcarFechado(id) {
    var m = mapaFechados(), h = diaSP();
    Object.keys(m).forEach(function (k) { if (k !== h) delete m[k]; });
    m[h] = (m[h] || []).filter(function (x) { return x !== id; }).concat([id]);
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }
  function agoraParam() {
    try { return new URLSearchParams(location.search).get("agora"); } catch (e) { return null; }
  }
  function urlAlertas() {
    var a = agoraParam();
    return a ? "/api/alertas?agora=" + encodeURIComponent(a) : "/api/alertas";
  }

  function ajustarAltura(box) {
    var h = box ? Math.ceil(box.getBoundingClientRect().height) : 0;
    document.body.classList.toggle("al-faixa-ativa", !!h);
    document.documentElement.style.setProperty("--al-faixa-h", h ? h + "px" : "0px");
  }

  function permissaoNotif() {
    return (typeof Notification !== "undefined") ? Notification.permission : "unsupported";
  }

  function notificar(novos) {
    if (!novos.length || permissaoNotif() !== "granted") return;
    var n = novos.length, prim = novos[0];
    var tit = n === 1 ? prim.titulo : n + " prazos vencem em até 8 h";
    var corpo = n === 1 ? (prim.card + " · " + prim.restante_txt) : novos.slice(0, 4).map(function (x) { return x.titulo + " (" + x.restante_txt + ")"; }).join(" · ");
    try {
      var nt = new Notification(tit, { body: corpo, tag: "kanzo-prazo-8h", icon: "/icon-192.png", lang: "pt-BR" });
      nt.onclick = function () { try { window.focus(); } catch (e) {} if (window.KanzoAbrirCard) window.KanzoAbrirCard(prim.card_id); nt.close(); };
    } catch (e) {}
  }

  function botaoNotif(topo) {
    var ant = topo.querySelector(".al-ativar-notif");
    if (ant) ant.remove();
    if (permissaoNotif() !== "default") return;
    var b = el("button", "al-ativar-notif", "Ativar notificações"); b.type = "button";
    b.addEventListener("click", function () {
      Notification.requestPermission().then(function (p) {
        if (p === "granted") { b.remove(); notificar(itensVisiveis()); }
        else b.remove();
      });
    });
    topo.appendChild(b);
  }

  function itensVisiveis() {
    var box = document.getElementById("alertas"); if (!box) return [];
    return Array.prototype.map.call(box.querySelectorAll(".al-item"), function (n) {
      return { id: n.getAttribute("data-id"), card_id: +n.getAttribute("data-card"), titulo: (n.querySelector(".al-acao") || {}).textContent, card: (n.querySelector(".al-card") || {}).textContent, restante_txt: (n.querySelector(".al-dias") || {}).textContent };
    });
  }

  function garantirFaixa() {
    var box = document.getElementById("alertas");
    if (box) return box;
    box = el("section", "alertas"); box.id = "alertas"; box.setAttribute("aria-label", "Prazos que vencem em até 8 horas"); box.setAttribute("role", "region");
    var topo = el("div", "al-topo");
    topo.appendChild(el("span", "al-titulo", "Vence em até 8 h"));
    var todos = el("button", "al-fechar-todos", "Fechar"); todos.type = "button";
    todos.addEventListener("click", function () {
      Array.prototype.slice.call(box.querySelectorAll(".al-item")).forEach(function (n) { marcarFechado(n.getAttribute("data-id")); });
      box.remove(); idsNaFaixa = {}; ajustarAltura(null);
    });
    topo.appendChild(todos);
    box.appendChild(topo);
    var lista = el("div", "al-lista"); box.appendChild(lista);
    document.body.insertBefore(box, document.body.firstChild);
    return box;
  }

  function montarItem(a) {
    var it = el("div", "al-item" + (a.vencido ? " al-atrasado" : ""));
    it.setAttribute("data-id", a.id); it.setAttribute("data-card", String(a.card_id)); it.setAttribute("role", "status");
    var corpo = el("div", "al-corpo");
    corpo.appendChild(el("div", "al-card", a.card));
    corpo.appendChild(el("div", "al-acao", a.titulo));
    var pz = el("div", "al-prazo");
    pz.appendChild(el("span", "al-dias", a.restante_txt));
    if (a.prazo_br) pz.appendChild(el("span", "al-data", " · " + a.prazo_br));
    corpo.appendChild(pz);
    var acoes = el("div", "al-acoes");
    var abrir = el("button", "btn btn-sm", "Abrir card"); abrir.type = "button";
    abrir.addEventListener("click", function () { if (window.KanzoAbrirCard) window.KanzoAbrirCard(a.card_id); });
    acoes.appendChild(abrir);
    var x = el("button", "al-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Fechar aviso de " + a.titulo);
    x.addEventListener("click", function () {
      marcarFechado(a.id);
      if (it.parentNode) it.parentNode.removeChild(it);
      delete idsNaFaixa[a.id];
      var box = document.getElementById("alertas");
      if (box && !box.querySelector(".al-item")) { box.remove(); idsNaFaixa = {}; ajustarAltura(null); }
      else ajustarAltura(box);
    });
    it.appendChild(corpo); it.appendChild(acoes); it.appendChild(x);
    return it;
  }

  function atualizarItem(it, a) {
    it.className = "al-item" + (a.vencido ? " al-atrasado" : "");
    var acao = it.querySelector(".al-acao"); if (acao) acao.textContent = a.titulo;
    var card = it.querySelector(".al-card"); if (card) card.textContent = a.card;
    var dias = it.querySelector(".al-dias"); if (dias) dias.textContent = a.restante_txt;
    var data = it.querySelector(".al-data");
    if (a.prazo_br) {
      if (data) data.textContent = " · " + a.prazo_br;
      else if (dias && dias.parentNode) dias.parentNode.appendChild(el("span", "al-data", " · " + a.prazo_br));
    }
  }

  function aplicar(itens) {
    itens = (itens || []).filter(function (a) { return a && a.id && !foiFechado(a.id); });
    if (!itens.length) {
      var box0 = document.getElementById("alertas");
      if (box0) { box0.remove(); idsNaFaixa = {}; ajustarAltura(null); }
      ultimaAssinatura = "";
      return;
    }
    var box = garantirFaixa();
    var topo = box.querySelector(".al-topo");
    var tit = box.querySelector(".al-titulo");
    tit.textContent = itens.length === 1 ? "1 prazo vence em até 8 h" : itens.length + " prazos vencem em até 8 h";
    botaoNotif(topo);
    var lista = box.querySelector(".al-lista");
    var novos = [];
    var vistos = {};
    itens.forEach(function (a) {
      vistos[a.id] = true;
      var esc = (window.CSS && CSS.escape) ? CSS.escape(a.id) : String(a.id).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      var it = lista.querySelector('.al-item[data-id="' + esc + '"]');
      if (it) atualizarItem(it, a);
      else { lista.appendChild(montarItem(a)); novos.push(a); idsNaFaixa[a.id] = 1; }
    });
    Array.prototype.slice.call(lista.querySelectorAll(".al-item")).forEach(function (n) {
      var id = n.getAttribute("data-id");
      if (!vistos[id]) { n.parentNode.removeChild(n); delete idsNaFaixa[id]; }
    });
    ajustarAltura(box);
    var sig = itens.map(function (a) { return a.id; }).sort().join("|");
    if (novos.length) notificar(novos);
    ultimaAssinatura = sig;
  }

  function carregar() {
    if (buscando) return;
    buscando = true;
    fetch(urlAlertas(), { credentials: "include", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) aplicar(d.itens || []); })
      .catch(function () {})
      .then(function () { buscando = false; });
  }

  function agendar() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (document.visibilityState === "hidden") return;
      carregar();
    }, POLL_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") carregar();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { carregar(); agendar(); });
  else { carregar(); agendar(); }
})();
