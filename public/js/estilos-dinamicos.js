/* CSP sem 'unsafe-inline': o HTML gerado não usa atributo de estilo inline. Valores dinâmicos vêm em data-bg (cor) e data-sx (escala 0..1)
   e são aplicados aqui via CSSOM (permitido pela CSP). byGui */
(function (g) {
  function aplicar(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    // Depois da primeira pintura, barras (data-p) e anéis (data-off) já entram no valor final: redesenhos não reanimam do zero.
    // data-i (--i) e data-off (--off) são sempre aplicados: --i é só acento do stagger (não anima em si).
    var fixo = document.documentElement.classList.contains("ja-pintou"),
      sel = fixo ? "[data-bg],[data-sx],[data-p],[data-i],[data-off]" : "[data-bg],[data-sx],[data-i],[data-off]";
    var els = [].slice.call(raiz.querySelectorAll(sel));
    if (raiz.matches && raiz.matches(sel)) els.push(raiz);
    els.forEach(function (el) {
      var bg = el.getAttribute("data-bg"), sx = el.getAttribute("data-sx"), dp = el.getAttribute("data-p"), di = el.getAttribute("data-i"), off = el.getAttribute("data-off");
      if (di != null) el.style.setProperty("--i", di);
      if (fixo && dp != null) el.style.setProperty("--p", dp);
      if (fixo && off != null) el.style.setProperty("--off", off);
      if (bg != null && el.style.background !== bg) el.style.background = bg;
      if (sx != null) { var v = parseFloat(sx); el.style.transform = "scaleX(" + (isFinite(v) ? Math.max(0, Math.min(1, v)) : 0) + ")"; }
    });
  }
  g.KanzoEstilos = { aplicar: aplicar };
  if (typeof MutationObserver === "undefined" || !g.document) return;
  function iniciar() {
    aplicar(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) aplicar(n); }); }); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) iniciar(); else document.addEventListener("DOMContentLoaded", iniciar);
})(typeof window !== "undefined" ? window : globalThis);
