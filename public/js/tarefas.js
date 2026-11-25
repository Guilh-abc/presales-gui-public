/* Tarefas dentro do card (remodelo 11/11/2026). Estilo Planner, do jeito do Guilherme: tarefa livre com prazo, marcar feita,
   editar, excluir; e as sugestões da etapa (seed em kanzo-core.js) para marcar como feita, adicionar ou dispensar.
   Funções puras (testáveis em node) + o bloco do card com eventos por delegação. Grava direto no app (/api/cards/:id/tasks, /api/tasks/:id).
   Perfil leitura: só vê a lista (sem botões e sem sugestões). byGui */
(function (g) {
  "use strict";
  var KC = g.KanzoCore;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function dataBR(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }

  /* ---------- puras ---------- */
  function doCard(tasks, cardId) { return (tasks || []).filter(function (t) { return String(t.card_id) === String(cardId); }); }
  function aberta(t) { return t && !t.done && !t.dismissed; }
  /* Ordem: abertas primeiro (prazo mais próximo, sem prazo no fim), depois as feitas (mais recente primeiro). Dispensadas não aparecem. */
  function visiveis(tasks) {
    return (tasks || []).filter(function (t) { return !t.dismissed; }).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (a.done) return String(b.done_at || "").localeCompare(String(a.done_at || ""));
      var da = a.due_date || "9999-99-99", db = b.due_date || "9999-99-99";
      return da < db ? -1 : da > db ? 1 : (a.id || 0) - (b.id || 0);
    });
  }
  /* Sugestões da etapa ATUAL ainda sem linha no card (feita, adicionada ou dispensada some daqui; tarefas pessoais nunca somem). */
  function sugestoesPendentes(card, tasksDoCard) {
    if (!card || !KC || !KC.sugestoesDaEtapa) return [];
    var tem = {}; (tasksDoCard || []).forEach(function (t) { if (t.sugg_key) tem[t.sugg_key] = 1; });
    return KC.sugestoesDaEtapa(card.stage, card.solution).filter(function (s) { return !tem[s.key]; });
  }
  /* Situação do prazo de uma tarefa aberta: null se feita/dispensada/sem prazo. */
  function prazoTarefa(t, agora) {
    if (!aberta(t) || !t.due_date) return null;
    var d = KC.diasAte(t.due_date, agora); if (d == null) return null;
    if (d < 0) return { dias: d, cls: "bad", t: "venceu há " + (-d) + (d === -1 ? " dia" : " dias"), urgente: true };
    if (d === 0) return { dias: 0, cls: "bad", t: "vence hoje", urgente: true };
    return { dias: d, cls: d <= 3 ? "warn" : "", t: d === 1 ? "vence amanhã" : "vence em " + d + " dias", urgente: false };
  }
  /* Exige ação: por card, as tarefas abertas vencidas ou para hoje (mais atrasada primeiro). */
  function urgentes(tasks, agora) {
    var m = {};
    (tasks || []).forEach(function (t) {
      var p = prazoTarefa(t, agora); if (!p || !p.urgente) return;
      (m[t.card_id] = m[t.card_id] || []).push({ t: t, p: p });
    });
    Object.keys(m).forEach(function (k) { m[k].sort(function (a, b) { return a.p.dias - b.p.dias; }); });
    return m;
  }
  /* Fallback de leitura da Situação atual: o texto narrativo solto da descrição (sem rótulos, tabelas, títulos, checklists).
     Só mostra; quem grava no campo certo é o usuário. */
  function narrativa(desc, max) {
    max = max || 420;
    var out = [];
    String(desc || "").replace(/\r\n/g, "\n").split("\n").some(function (l) {
      var t = l.trim();
      if (!t) return false;
      if (/^\*\*[^*\n]{2,60}?:\*\*/.test(t) || /^\|/.test(t) || /^#{1,6}\s/.test(t) || /^[-*]\s*\[[ xX]\]/.test(t) || /^(-{3,}|\*{3,})$/.test(t) || /^\[trecho interno omitido\]$/.test(t)) return false;
      if (/^[-*]\s+\*\*[^*]+:\*\*/.test(t)) return false;
      out.push(t.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").replace(/`/g, ""));
      return out.join(" ").length >= max;
    });
    var s = out.join(" ").replace(/\s+/g, " ").trim();
    if (s.length < 12) return "";
    return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : s;
  }

  /* ---------- bloco do card ---------- */
  function itemHtml(t, o) {
    var p = prazoTarefa(t, o.agora), cw = o.cw, ed = cw && String(o.editId) === String(t.id);
    var cls = "tk-i" + (t.done ? " done" : "") + (p && p.urgente ? " late" : "");
    if (ed) {
      return '<li class="' + cls + ' editing" data-tk="' + esc(t.id) + '"><form class="tk-ed" data-tk-form="editar">' +
        (t.source === "suggestion" ? '<span class="tk-t">' + esc(t.title) + "</span>" : '<label class="tk-fl"><span class="sr-only">Tarefa</span><input class="inp" name="title" maxlength="200" required value="' + esc(t.title) + '"></label>') +
        '<label class="tk-fl tk-dt"><span>Prazo</span><input class="inp" type="date" name="due" value="' + esc(t.due_date || "") + '"></label>' +
        '<div class="tk-row"><button type="submit" class="btn btn-sm btn-primary">Salvar</button><button type="button" class="btn btn-sm" data-tk-acao="cancelar">Cancelar</button></div></form></li>';
    }
    var chk = cw ? '<button type="button" class="tk-chk" role="checkbox" aria-checked="' + (t.done ? "true" : "false") + '" data-tk-acao="feita" aria-label="' + esc((t.done ? "Desmarcar: " : "Marcar como feita: ") + t.title) + '"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></button>'
      : '<span class="tk-chk ro" role="img" aria-label="' + (t.done ? "feita" : "aberta") + '">' + (t.done ? '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : "") + "</span>";
    var meta = (p ? '<span class="tag ' + p.cls + '">' + esc(p.t) + "</span>" : t.due_date && !t.done ? '<span class="tag dim">' + esc(dataBR(t.due_date)) + "</span>" : "") +
      (t.done && t.done_at ? '<span class="tk-q">feita</span>' : "") + (t.source === "suggestion" ? '<span class="tag dim">da etapa</span>' : "");
    var acoes = cw ? '<div class="tk-a"><button type="button" class="btn btn-ghost btn-sm tk-ib" data-tk-acao="editar" aria-label="' + esc("Editar prazo" + (t.source === "suggestion" ? "" : " e texto") + ": " + t.title) + '"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' +
      '<button type="button" class="btn btn-ghost btn-sm tk-ib" data-tk-acao="excluir" aria-label="' + esc("Excluir: " + t.title) + '"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' : "";
    return '<li class="' + cls + '" data-tk="' + esc(t.id) + '">' + chk + '<div class="tk-c"><span class="tk-t">' + esc(t.title) + "</span>" + (meta ? '<span class="tk-m">' + meta + "</span>" : "") + "</div>" + acoes + "</li>";
  }
  /* o: { cw, agora, editId, carregando, erro, stageLabel } */
  function blocoHtml(card, tasksDoCard, o) {
    o = o || {};
    var vis = visiveis(tasksDoCard), feitas = vis.filter(function (t) { return t.done; }).length;
    var sug = o.cw ? sugestoesPendentes(card, tasksDoCard) : [];
    var h = '<section class="dblk tk" id="d-tasks" aria-labelledby="tk-h"><div class="dblk-h"><h3 id="tk-h"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Tarefas do projeto</h3><span class="meta">' +
      (o.carregando ? "carregando…" : o.erro ? "indisponível" : vis.length ? feitas + " de " + vis.length + " feitas" : "nenhuma ainda") + "</span></div>";
    if (o.erro) h += '<p class="tk-vazio">Não foi possível carregar as tarefas agora. ' + esc(o.erro) + "</p>";
    else if (vis.length) h += '<ul class="tk-list">' + vis.map(function (t) { return itemHtml(t, o); }).join("") + "</ul>";
    else if (!o.carregando && !sug.length) h += '<p class="tk-vazio">' + (o.cw ? "Crie a primeira tarefa abaixo: o que precisa acontecer, com prazo." : "Sem tarefas neste projeto.") + "</p>";
    if (sug.length) h += '<div class="tk-sug"><p class="tk-sub">Sugestões para a etapa ' + esc(o.stageLabel || card.stage_label || card.stage || "") + "</p><ul>" + sug.map(function (s) {
      return '<li class="tk-s" data-sg="' + esc(s.key) + '"><span class="tk-t">' + esc(s.title) + (s.opcional ? ' <span class="tk-q">opcional</span>' : "") + '</span><div class="tk-row">' +
        '<button type="button" class="btn btn-sm" data-sg-acao="feita">Feita</button><button type="button" class="btn btn-sm" data-sg-acao="add">Adicionar</button><button type="button" class="btn btn-sm btn-ghost" data-sg-acao="dispensar">Dispensar</button></div></li>';
    }).join("") + "</ul></div>";
    if (o.cw && !o.erro) h += '<form class="tk-add" data-tk-form="nova"><label class="tk-fl tk-grow"><span class="sr-only">Nova tarefa</span><input class="inp" name="title" maxlength="200" autocomplete="off" placeholder="Nova tarefa: o que precisa acontecer"></label>' +
      '<label class="tk-fl tk-dt"><span>Prazo</span><input class="inp" type="date" name="due"></label><button type="submit" class="btn btn-sm btn-primary">Adicionar</button></form>';
    return h + "</section>";
  }

  /* ---------- eventos (delegação no corpo do card) ---------- */
  /* o: { raiz, card(), tasks(), setTasks(lista), canWrite(), toast(msg), write(method, path, body), onChange() , editId get/set } */
  function montar(o) {
    var ocupado = false;
    function trocar(nova) { var l = (o.tasks() || []).filter(function (t) { return t.id !== nova.id; }); l.push(nova); o.setTasks(l); }
    async function chamar(fn, okMsg) {
      if (ocupado) return; ocupado = true;
      try { var r = await fn(); if (okMsg) o.toast(okMsg); return r; }
      catch (e) { o.toast("Tarefa não salvou: " + ((e && e.message) || "erro")); }
      finally { ocupado = false; o.onChange(); }
    }
    function tarefa(id) { return (o.tasks() || []).filter(function (t) { return String(t.id) === String(id); })[0]; }
    o.raiz.addEventListener("click", function (e) {
      if (!o.canWrite()) return;
      var b = e.target.closest("[data-tk-acao]"), s = e.target.closest("[data-sg-acao]"), card = o.card();
      if (!card || (!b && !s)) return;
      if (s) {
        var key = s.closest("[data-sg]").getAttribute("data-sg"), ac = s.getAttribute("data-sg-acao");
        var body = { source: "suggestion", sugg_key: key }; if (ac === "feita") body.done = true; if (ac === "dispensar") body.dismissed = true;
        chamar(async function () { trocar(await o.write("POST", "/api/cards/" + encodeURIComponent(card.id) + "/tasks", body)); },
          ac === "feita" ? "Sugestão marcada como feita." : ac === "dispensar" ? "Sugestão dispensada." : "Sugestão virou tarefa. Ponha um prazo no lápis.");
        return;
      }
      var li = b.closest("[data-tk]"), id = li && li.getAttribute("data-tk"), t = tarefa(id), a = b.getAttribute("data-tk-acao");
      if (a === "cancelar") { o.setEditId(null); o.onChange(); return; }
      if (!t) return;
      if (a === "editar") { o.setEditId(t.id); o.onChange(); setTimeout(function () { var i = o.raiz.querySelector('[data-tk="' + t.id + '"] input'); if (i) i.focus(); }, 0); return; }
      if (a === "feita") { chamar(async function () { trocar(await o.write("PATCH", "/api/tasks/" + t.id, { done: !t.done })); }); return; }
      if (a === "excluir") {
        if (!g.confirm("Excluir a tarefa “" + t.title + "”?")) return;
        chamar(async function () { await o.write("DELETE", "/api/tasks/" + t.id); o.setTasks((o.tasks() || []).filter(function (x) { return x.id !== t.id; })); }, "Tarefa excluída.");
      }
    });
    o.raiz.addEventListener("submit", function (e) {
      var f = e.target.closest("[data-tk-form]"); if (!f) return;
      e.preventDefault(); if (!o.canWrite()) return;
      var card = o.card(); if (!card) return;
      var ti = f.querySelector('[name="title"]'), du = f.querySelector('[name="due"]');
      if (f.getAttribute("data-tk-form") === "nova") {
        var titulo = ti.value.trim(); if (!titulo) { ti.focus(); return; }
        chamar(async function () { trocar(await o.write("POST", "/api/cards/" + encodeURIComponent(card.id) + "/tasks", { title: titulo, due_date: du.value || null })); }, "Tarefa criada.")
          .then(function () { var n = o.raiz.querySelector('[data-tk-form="nova"] [name="title"]'); if (n) n.focus(); });
        return;
      }
      var li = f.closest("[data-tk]"), t = tarefa(li && li.getAttribute("data-tk")); if (!t) return;
      var body = { due_date: du.value || null }; if (ti) { if (!ti.value.trim()) { ti.focus(); return; } body.title = ti.value.trim(); }
      o.setEditId(null);
      chamar(async function () { trocar(await o.write("PATCH", "/api/tasks/" + t.id, body)); }, "Tarefa atualizada.");
    });
  }

  g.KanzoTarefas = { doCard: doCard, visiveis: visiveis, sugestoesPendentes: sugestoesPendentes, prazoTarefa: prazoTarefa, urgentes: urgentes,
    narrativa: narrativa, blocoHtml: blocoHtml, montar: montar };
})(typeof window !== "undefined" ? window : globalThis);
