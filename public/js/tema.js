/* Lote 7: tema claro/escuro. Roda no <head> (arquivo próprio, sem script inline) para não piscar.
   Repaginação clara 13/11: ordem = escolha salva (botão) > claro. O escuro continua como alternativa
   no botão de tema; o sistema (prefers-color-scheme: light/dark) não troca mais a primeira tela. byGui */
(function (g) {
  var d = g.document.documentElement, CH = "kanzo.tema";
  function salvo() { try { var t = g.localStorage.getItem(CH); return t === "claro" || t === "escuro" ? t : null; } catch (_) { return null; } }
  function aplicar(t) { if (t === "claro") d.setAttribute("data-tema", "claro"); else d.removeAttribute("data-tema"); d.setAttribute("data-theme", t === "claro" ? "light" : "dark"); d.style.colorScheme = t === "claro" ? "light" : "dark"; corBarra(); }
  /* Repaginação 12/11: a cor da barra do celular segue o token --background do tema. */
  function corBarra() { try { var m = g.document.querySelector('meta[name="theme-color"]'), v = g.getComputedStyle(d).getPropertyValue("--background").trim(); if (m && v) m.setAttribute("content", v); } catch (_) {} }
  if (g.addEventListener) g.addEventListener("DOMContentLoaded", corBarra);
  function atual() { return d.getAttribute("data-tema") === "claro" ? "claro" : "escuro"; }
  aplicar(salvo() || "claro");
  g.KanzoTema = { atual: atual, alternar: function () { var t = atual() === "claro" ? "escuro" : "claro"; try { g.localStorage.setItem(CH, t); } catch (_) {} aplicar(t); if (g.KanzoTema.onChange) g.KanzoTema.onChange(); return t; }, onChange: null };
})(window);
