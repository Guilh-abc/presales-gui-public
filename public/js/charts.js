/* Gráficos em HTML/SVG acessíveis. Animação só por transform, opacity e stroke-dashoffset.
   Lote 8: anel() e linha() se desenham com stroke-dashoffset (data-off → var --off), no
   mesmo esquema de primeira pintura das barras (data-p → var --p). byGui */
(function (g) {
  var F = g.KanzoFmt;
  var RM = (g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)")) || { matches: false };
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  var cor = function (c) {
    if (typeof c !== "string" || c.indexOf("var(") !== 0) return c;
    var v = cssVar(c.slice(4, c.length - 1).trim());
    return v || c;
  };
  function finalDireto(root) {
    /* estado final imediato: redesenhos depois da primeira pintura, movimento reduzido
       (sem transição) e impressão já chegam prontos; nada reanima. */
    root.querySelectorAll("[data-p]").forEach(function (el) { el.style.setProperty("--p", el.getAttribute("data-p")); });
    root.querySelectorAll("[data-off]").forEach(function (el) { el.style.setProperty("--off", el.getAttribute("data-off")); });
    root.querySelectorAll(".linha").forEach(function (x) { x.classList.add("reve"); });
    if (root.matches && root.matches(".linha")) root.classList.add("reve");
  }
  var io = null, pend = [];
  function pegaIO() {
    if (io || !("IntersectionObserver" in window)) return null;
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        pend = pend.filter(function (r) { return r !== en.target; });
        oca(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    return io;
  }
  /* Estados "escondidos" (barras em --p:0, curvas em --off:1) são pintados uma vez; duas
     quadros depois o valor final entra e a transição desenha. Só na primeira pintura,
     ou quando o gráfico entra na tela pela primeira vez (gráficos fora da vista). */
  function oca(root) {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      finalDireto(root);
    }); });
  }
  function animate(root) {
    if (document.documentElement.classList.contains("ja-pintou") || RM.matches || !("IntersectionObserver" in window)) return finalDireto(root);
    var r = (g.matchMedia && root.getBoundingClientRect) ? root.getBoundingClientRect() : { bottom: 0, top: 0 };
    if ((r.bottom < 0 || r.top > (g.innerHeight || 900)) && pegaIO()) { pend.push(root); io.observe(root); return; }
    oca(root);
  }
  /* Lote 1: tabela só para leitor de tela com os mesmos números do gráfico. */
  function srTable(titulo, cols, linhas) {
    return '<div class="sr-only"><table><caption>' + F.esc(titulo) + '</caption><thead><tr>' + cols.map(function (c) { return '<th scope="col">' + F.esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + linhas.map(function (l) { return '<tr>' + l.map(function (v, i) { return (i ? '<td>' : '<th scope="row">') + F.esc(v) + (i ? '</td>' : '</th>'); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  /* items: [{label, value, sub?, late?, tip?, action?, display?}]  opts: {titulo, fmt, colunas, total, pct, empty} */
  function hbars(root, items, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return i.value; })));
    var total = opts.total || items.reduce(function (s, i) { return s + i.value; }, 0) || 1;
    if (!items.length) { root.innerHTML = opts.empty || '<div class="empty">Sem dados.</div>'; return; }
    if (opts.titulo) { root.setAttribute("role", "group"); root.setAttribute("aria-label", opts.titulo); }
    var fmt = opts.fmt || function (v) { return String(v); };
    root.innerHTML = items.map(function (it) {
      var p = (it.value / max).toFixed(4), pl = it.late ? (it.late / max).toFixed(4) : 0;
      var pct = Math.round(it.value / total * 100);
      var tip = (it.tip || (it.label + ": " + it.value)) + (opts.pct !== false ? "\n" + pct + "% do total" : "");
      var tagName = it.action ? "button" : "div";
      return '<' + tagName + (it.action ? ' type="button" data-act="' + F.esc(it.action) + '" aria-pressed="' + !!it.sel + '"' : '') + ' class="hb' + (it.value ? '' : ' zero') + (it.cls ? ' tone-' + it.cls : '') + (it.sel ? ' sel' : '') + '" data-tip="' + F.esc(tip) + '">' +
        '<span class="l">' + F.esc(it.label) + '</span>' +
        '<span class="t" aria-hidden="true"><i data-p="' + p + '"></i>' + (it.late ? '<i class="late" data-p="' + pl + '"></i>' : '') + '</span>' +
        '<span class="n">' + F.esc(it.display != null ? it.display : fmt(it.value)) + (it.sub != null ? '<small>' + F.esc(it.sub) + '</small>' : '') + '</span></' + tagName + '>';
    }).join("") + (opts.titulo ? srTable(opts.titulo, opts.colunas || ["Item", "Quantidade"], items.map(function (it) {
      return [it.label, it.display != null ? it.display : fmt(it.value)].concat(it.sub != null ? [String(it.sub)] : []).concat(it.late ? [it.late + " atrasados"] : []);
    })) : "");
    animate(root);
  }
  /* Lote 4: colunas agrupadas por mês (HTML; altura por transform scaleY via --p). meses: [{label, valores:[n...], action?, sel?}] series: [{nome, cls}] */
  function colunas(root, meses, series, opts) {
    opts = opts || {};
    var max = 1; meses.forEach(function (m) { m.valores.forEach(function (v) { if (v > max) max = v; }); });
    var vazio = !meses.some(function (m) { return m.valores.some(function (v) { return v; }); });
    if (vazio) { root.innerHTML = opts.empty || '<div class="empty">Sem dados.</div>'; return; }
    root.setAttribute("role", "group"); if (opts.titulo) root.setAttribute("aria-label", opts.titulo);
    root.innerHTML = '<div class="cols-wrap"><div class="cols">' + meses.map(function (m) {
      var resumo = m.label + ": " + series.map(function (s, i) { return s.nome + " " + m.valores[i]; }).join(", ");
      var tip = m.label + "\n" + series.map(function (s, i) { return s.nome + ": " + m.valores[i]; }).join("\n") + (m.action ? "\nClique para filtrar pelo mês de criação." : "");
      return '<button type="button" class="col' + (m.sel ? " sel" : "") + '"' + (m.action ? ' data-act="' + F.esc(m.action) + '" aria-pressed="' + !!m.sel + '"' : " disabled") + ' aria-label="' + F.esc(resumo) + '" data-tip="' + F.esc(tip) + '">' +
        '<span class="cb" aria-hidden="true">' + series.map(function (s, i) { return '<i class="' + (s.cls || "s" + (i + 1)) + '" data-p="' + (m.valores[i] / max).toFixed(4) + '"></i>'; }).join("") + '</span>' +
        '<span class="cl" aria-hidden="true">' + F.esc(m.curto || m.label) + '</span></button>';
    }).join("") + '</div></div>' +
      '<div class="legend cols-leg" aria-hidden="true">' + series.map(function (s, i) { return '<span><i class="sw ' + (s.cls || "s" + (i + 1)) + '"></i>' + F.esc(s.nome) + '</span>'; }).join("") + '</div>' +
      srTable(opts.titulo || "Evolução mensal", ["Mês"].concat(series.map(function (s) { return s.nome; })), meses.map(function (m) { return [m.label].concat(m.valores.map(String)); }));
    animate(root);
    var wr = root.querySelector(".cols-wrap"); if (wr) requestAnimationFrame(function () { wr.scrollLeft = wr.scrollWidth; });
  }
  /* Lote 8: anel que se desenha. Cada parte é um círculo com pathLength=1, dasharray "1 1"
     e o traço-do-offset final guardado em data-off: o CSS parte de --off:1 (nada desenhado)
     e o JS aplica o valor final, então a transição do stroke-dashoffset encerra o desenho.
     parts: [{label, value, color, tip?, action?, sel?}]  opts: {titulo, centro, centroSub, colunas, empty} */
  function anel(root, parts, opts) {
    opts = opts || {};
    var ns = "http://www.w3.org/2000/svg";
    var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
    if (!total) { root.innerHTML = opts.empty || '<div class="empty">Sem dados.</div>'; return; }
    root.classList.add("anel"); /* repaginação 12/11: garante o tamanho e o traço dos segmentos (antes o CSS .anel não casava) */
    if (opts.titulo) { root.setAttribute("role", "group"); root.setAttribute("aria-label", opts.titulo); }
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 160 160"); svg.setAttribute("class", "anel-svg");
    var resumo = (opts.titulo || "Distribuição") + ": " + parts.filter(function (p) { return p.value; }).map(function (p) { return p.label + " " + p.value + " (" + Math.round(p.value / total * 100) + "%)"; }).join(", ");
    var tt = document.createElementNS(ns, "title"); tt.textContent = resumo; svg.appendChild(tt);
    var track = document.createElementNS(ns, "circle");
    track.setAttribute("cx", "80"); track.setAttribute("cy", "80"); track.setAttribute("r", "58");
    track.setAttribute("class", "anel-track"); track.setAttribute("fill", "none");
    track.setAttribute("stroke", cssVar("--chart-track") || "currentColor"); track.setAttribute("stroke-width", "20");
    svg.appendChild(track);
    var a0 = -90;
    parts.forEach(function (p, i) {
      if (!p.value) return;
      var f = p.value / total;
      var seg = document.createElementNS(ns, "circle");
      seg.setAttribute("cx", "80"); seg.setAttribute("cy", "80"); seg.setAttribute("r", "58");
      seg.setAttribute("pathLength", "1"); seg.setAttribute("class", "seg");
      seg.setAttribute("stroke", cor(p.color)); seg.setAttribute("stroke-width", "20"); seg.setAttribute("fill", "none");
      /* dasharray "1 1": a parte visível tem comprimento 1 - off; off final = 1 - f. */
      var offFim = String((1 - f).toFixed(4));
      seg.setAttribute("data-off", offFim);
      if (f > 0.999) seg.setAttribute("stroke-dasharray", "1 0");
      /* círculo completo: dasharray "1 0" (só o traço); offset 0 = tudo desenhado. */
      seg.setAttribute("transform", "rotate(" + a0 + " 80 80)");
      seg.setAttribute("data-tip", p.tip || (p.label + ": " + p.value + " (" + Math.round(f * 100) + "%)"));
      seg.setAttribute("data-i", String(i));
      svg.appendChild(seg);
      a0 += f * 360;
    });
    var t = document.createElementNS(ns, "text");
    t.setAttribute("x", "80"); t.setAttribute("y", "86"); t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "anel-num");
    /* Repaginação 13/11: texto do centro cabe no anel (valor em R$ e legenda longa encolhem). */
    var cTxt = opts.centro != null ? String(opts.centro) : String(total), sTxt = opts.centroSub || "partes";
    t.setAttribute("fill", cssVar("--text-primary") || "currentColor"); t.setAttribute("font-size", cTxt.length > 6 ? "17" : "26"); t.setAttribute("font-weight", "600");
    t.textContent = cTxt;
    svg.appendChild(t);
    var t2 = document.createElementNS(ns, "text");
    t2.setAttribute("x", "80"); t2.setAttribute("y", "102"); t2.setAttribute("text-anchor", "middle");
    t2.setAttribute("fill", cssVar("--text-tertiary") || "currentColor"); t2.setAttribute("font-size", sTxt.length > 14 ? "8.5" : "11");
    t2.textContent = sTxt;
    svg.appendChild(t2);
    var leg = '<ul class="anel-l" aria-hidden="false">' + parts.map(function (p) {
      var tag = p.action ? "button" : "div";
      return '<li><' + tag + (p.action ? ' type="button" data-act="' + F.esc(p.action) + '" aria-pressed="' + !!p.sel + '"' : "") + ' class="lg' + (p.sel ? " on" : "") + '"' + (p.tip ? ' data-tip="' + F.esc(p.tip) + '"' : "") + '><i class="sw" data-bg="' + F.esc(cor(p.color)) + '"></i>' + F.esc(p.label) + ' <b>' + F.esc(String(Math.round(p.value / total * 100)) + "%") + '</b></' + tag + '></li>';
    }).join("") + "</ul>";
    root.innerHTML = "";
    root.appendChild(svg);
    root.insertAdjacentHTML("beforeend", leg);
    if (opts.titulo) root.insertAdjacentHTML("beforeend", srTable(opts.titulo, opts.colunas || ["Item", "Partes"], parts.map(function (p) {
      return [p.label, p.value + " (" + Math.round(p.value / total * 100) + "%)"];
    })));
    animate(root);
  }
  /* Lote 8: evolução mensal em linha. Curva monotônica (Fritsch-Carlson): não inventa picos
     nem vales entre meses; área e pontos preenchem depois (opacity). Legenda-mês filtra.
     meses: [{label, curto?, valores:[n...], action?, sel?}]  series: [{nome}] opts: {titulo, empty} */
  function linha(root, meses, series, opts) {
    opts = opts || {};
    root.classList.add("linha");
    var temDado = meses.some(function (m) { return m.valores.some(function (v) { return v; }); });
    if (!temDado) { root.innerHTML = opts.empty || '<div class="empty">Sem dados.</div>'; return; }
    var max = 1; meses.forEach(function (m) { m.valores.forEach(function (v) { if (v > max) max = v; }); });
    var W = 640, H = 240, padX = 34, padT = 16, padB = 30;
    var n = meses.length;
    function x(i) { return padX + (i * (W - padX - 10)) / Math.max(1, n - 1); }
    function y(v) { return padT + (H - padT - padB) * (1 - v / max); }
    function suave(ch) {
      var p = meses.map(function (m, i) { return [x(i), y(m.valores[ch])]; }), k = 0, dx = [], sl = [], tg = [];
      for (k = 0; k < n - 1; k++) { dx[k] = p[k + 1][0] - p[k][0]; sl[k] = (p[k + 1][1] - p[k][1]) / dx[k]; }
      tg[0] = sl[0]; tg[n - 1] = sl[n - 2];
      for (k = 1; k < n - 1; k++) tg[k] = sl[k - 1] * sl[k] <= 0 ? 0 : (sl[k - 1] + sl[k]) / 2;
      for (k = 0; k < n - 1; k++) {
        if (sl[k] === 0) { tg[k] = tg[k + 1] = 0; continue; }
        var a = tg[k] / sl[k], b = tg[k + 1] / sl[k], h = a * a + b * b;
        if (h > 9) { var q = 3 / Math.sqrt(h); tg[k] = q * a * sl[k]; tg[k + 1] = q * b * sl[k]; }
      }
      var s = "M" + p[0][0].toFixed(1) + " " + p[0][1].toFixed(1);
      for (k = 0; k < n - 1; k++) s += " C" + (p[k][0] + dx[k] / 3).toFixed(1) + " " + (p[k][1] + tg[k] * dx[k] / 3).toFixed(1) + " " + (p[k + 1][0] - dx[k] / 3).toFixed(1) + " " + (p[k + 1][1] - tg[k + 1] * dx[k] / 3).toFixed(1) + " " + p[k + 1][0].toFixed(1) + " " + p[k + 1][1].toFixed(1);
      return s;
    }
    var grade = "", lx = "", areia = "", curvas = "", dots = "";
    [0, 0.5, 1].forEach(function (f) { var yy = (padT + f * (H - padT - padB)).toFixed(1); grade += '<line class="grade" x1="' + padX + '" x2="' + (W - 10) + '" y1="' + yy + '" y2="' + yy + '"/>'; });
    meses.forEach(function (m, i) { lx += '<line class="lx" x1="' + x(i).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y1="' + (H - padB) + '" y2="' + (H - padB + 5) + '"/>'; });
    series.forEach(function (s, ch) {
      areia += '<path class="fundo st' + (ch + 1) + '" d="' + suave(ch) + " L " + x(n - 1).toFixed(1) + " " + (H - padB) + " L " + x(0).toFixed(1) + " " + (H - padB) + ' Z"/>';
      curvas += '<path class="curva st' + (ch + 1) + '" pathLength="1" data-off="0" d="' + suave(ch) + '"/>';
    });
    meses.forEach(function (m, i) {
      var c = "";
      series.forEach(function (s, ch) { c += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(m.valores[ch]).toFixed(1) + '" r="3.5" fill="' + cor("var(--c" + (ch + 1) + ")") + '" data-tip="' + F.esc(m.label + " · " + s.nome + ": " + m.valores[ch]) + '"/>'; });
      dots += '<g data-i="' + i + '">' + c + "</g>";
    });
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("role", "group");
    if (opts.titulo) svg.setAttribute("aria-label", opts.titulo);
    svg.insertAdjacentHTML("beforeend", grade + lx + areia + curvas + dots);
    root.innerHTML = "";
    root.appendChild(svg);
    root.insertAdjacentHTML("beforeend", '<ul class="linha-meses" role="group" aria-label="Meses">' + meses.map(function (m) {
      var tag = m.action ? "button" : "span";
      return '<li><' + tag + (m.action ? ' type="button" data-act="' + F.esc(m.action) + '" aria-pressed="' + !!m.sel + '"' : "") + ' class="lm' + (m.sel ? " on" : "") + '" data-tip="' + F.esc(m.label + "\n" + series.map(function (s, ix) { return s.nome + ": " + m.valores[ix]; }).join("\n") + (m.action ? "\nClique para filtrar pelo mês de criação." : "")) + '">' + F.esc(m.curto || m.label) + "</" + tag + "></li>";
    }).join("") + "</ul>");
    if (opts.titulo) root.insertAdjacentHTML("beforeend", srTable(opts.titulo, ["Mês"].concat(series.map(function (s) { return s.nome; })), meses.map(function (m) { return [m.label].concat(m.valores.map(String)); })));
    animate(root);
  }
  /* Lote 8: o donut antigo (arcos) vira anel desenhável (stroke-dashoffset), mantendo
     <title>, texto central e as mesmas partes. */
  function donut(svg, parts) {
    var ns = "http://www.w3.org/2000/svg";
    var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var resumo = (svg.getAttribute("data-titulo") || "Distribuição") + ": " + (total ? parts.filter(function (p) { return p.value; }).map(function (p) { return p.label + " " + p.value + " (" + Math.round(p.value / total * 100) + "%)"; }).join(", ") : "sem dados");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", resumo);
    var tt = document.createElementNS(ns, "title"); tt.textContent = resumo; svg.appendChild(tt);
    var cx = 80, cy = 80, r = 58, sw = 20, a0 = -90;
    var bg = document.createElementNS(ns, "circle");
    bg.setAttribute("cx", cx); bg.setAttribute("cy", cy); bg.setAttribute("r", r);
    bg.setAttribute("fill", "none"); bg.setAttribute("stroke", cssVar("--chart-track") || "currentColor"); bg.setAttribute("stroke-width", sw);
    svg.appendChild(bg);
    parts.forEach(function (p, i) {
      if (!p.value) return;
      var f = p.value / (total || 1);
      var seg = document.createElementNS(ns, "circle");
      seg.setAttribute("cx", cx); seg.setAttribute("cy", cy); seg.setAttribute("r", r);
      seg.setAttribute("pathLength", "1"); seg.setAttribute("class", "seg");
      seg.setAttribute("stroke", cor(p.color)); seg.setAttribute("stroke-width", sw); seg.setAttribute("fill", "none");
      seg.setAttribute("data-off", String((1 - f).toFixed(4)));
      if (f > 0.999) seg.setAttribute("stroke-dasharray", "1 0");
      seg.setAttribute("transform", "rotate(" + a0 + " " + cx + " " + cy + ")");
      seg.setAttribute("data-tip", p.label + ": " + p.value + " (" + Math.round(f * 100) + "%)");
      seg.setAttribute("data-i", String(i));
      svg.appendChild(seg);
      a0 += f * 360;
    });
    var t = document.createElementNS(ns, "text");
    t.setAttribute("x", cx); t.setAttribute("y", cy - 2); t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "anel-num");
    t.setAttribute("fill", cssVar("--text-primary") || "currentColor"); t.setAttribute("font-size", "26"); t.setAttribute("font-weight", "600");
    t.textContent = String(total); svg.appendChild(t);
    var t2 = document.createElementNS(ns, "text");
    t2.setAttribute("x", cx); t2.setAttribute("y", cy + 20); t2.setAttribute("text-anchor", "middle");
    t2.setAttribute("fill", cssVar("--text-tertiary") || "currentColor"); t2.setAttribute("font-size", "11");
    t2.textContent = "cards"; svg.appendChild(t2);
    animate(svg);
  }
  g.KanzoCharts = { colunas: colunas, hbars: hbars, anel: anel, linha: linha, donut: donut, animate: animate, srTable: srTable };
})(window);
