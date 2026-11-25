/* Documentos e links do card (18/11/2026). Só links (nada de arquivo): título, tipo, URL, versão, observação.
   Cada link tem versão e histórico; editar nunca sobrescreve em silêncio (o servidor guarda antes/depois, quem e quando).
   Funções puras (testáveis em node) + o bloco do card (<details>) com eventos por delegação. API: /api/cards/:id/docs, /api/docs/:id[/remove|/history].
   Perfil leitura: só vê e abre os links (sem botões de escrita). Admin: adiciona, edita, nova versão, remove com motivo e vê o histórico. */
(function (g) {
  "use strict";
  var TIPOS = ["Apresentação final", "Proposta técnica", "Proposta comercial", "Cotação", "Pricing", "Contrato", "Ata", "Outro"];
  var LIM = { titulo: [3, 120], versao: 20, nota: 300, motivo: 200 };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ico(p) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>"; }
  var IC = {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    hist: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
    ver: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };

  /* ---------- puras ---------- */
  function hostDe(url) { var m = /^https?:\/\/([^/?#]+)/i.exec(url || ""); return m ? m[1].toLowerCase().replace(/^www\./, "") : ""; }
  function porData(a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (b.id || 0) - (a.id || 0); }
  /* Cadeia de versões de um item (ancestrais + descendentes), mais antiga primeiro, passando por itens removidos. */
  function cadeiaDe(todos, id) {
    var por = {}; (todos || []).forEach(function (x) { por[x.id] = x; });
    var n = por[id]; if (!n) return [];
    var guarda = 0; while (n.parent_id && por[n.parent_id] && guarda++ < 500) n = por[n.parent_id];
    var out = [], vistos = {};
    (function descer(x) { if (!x || vistos[x.id]) return; vistos[x.id] = 1; out.push(x); (todos || []).filter(function (y) { return y.parent_id === x.id; }).sort(function (a, b) { return -porData(a, b); }).forEach(descer); })(n);
    return out;
  }
  function rotuloVersao(d, i) { return d.version ? d.version : "#" + (i + 1); }
  /* Filtro da seção: por tipo e busca em título, observação e versão (sem acento, sem caixa). */
  function norm(s) { return String(s || "").toLowerCase().normalize ? String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : String(s || "").toLowerCase(); }
  function filtrar(docs, tipo, busca) {
    var q = norm(busca).trim();
    return (docs || []).filter(function (d) {
      if (tipo && d.doc_type !== tipo) return false;
      return !q || norm(d.title + " " + (d.note || "") + " " + (d.version || "")).indexOf(q) >= 0;
    });
  }
  /* Separa os "Atuais" (o mais novo de cada tipo) do resto (versões antigas), ambos do mais novo para o mais velho. */
  function separar(docs) {
    var a = [], v = [];
    (docs || []).slice().sort(porData).forEach(function (d) { (d.atual ? a : v).push(d); });
    return { atuais: a, antigas: v };
  }
  /* Próxima versão sugerida: v2 depois de v1; senão vazio (quem escreve decide). */
  function proximaVersao(v) { var m = /^(.*?)(\d+)$/.exec(String(v || "").trim()); return m ? m[1] + (parseInt(m[2], 10) + 1) : ""; }
  /* Checagem de campos antes de enviar (o servidor repete tudo). Devolve null ou {campo, msg}. */
  function validar(v, novo) {
    var t = String(v.title || "").replace(/\s+/g, " ").trim();
    if (t.length < LIM.titulo[0]) return { campo: "title", msg: "Título com pelo menos " + LIM.titulo[0] + " caracteres." };
    if (t.length > LIM.titulo[1]) return { campo: "title", msg: "Título com no máximo " + LIM.titulo[1] + " caracteres." };
    if (novo && TIPOS.indexOf(v.doc_type) < 0) return { campo: "doc_type", msg: "Escolha o tipo do documento." };
    var u = String(v.url || "").trim();
    if (!u) return { campo: "url", msg: "Cole o link do documento." };
    if (!/^https?:\/\//i.test(u)) return { campo: "url", msg: "Só links http ou https (ex.: https://…)." };
    if (/\s/.test(u)) return { campo: "url", msg: "O link não pode ter espaços." };
    if (String(v.version || "").length > LIM.versao) return { campo: "version", msg: "Versão com no máximo " + LIM.versao + " caracteres." };
    if (String(v.note || "").length > LIM.nota) return { campo: "note", msg: "Observação com no máximo " + LIM.nota + " caracteres." };
    return null;
  }
  var ACAO = { create: "Criado", edit: "Editado", remove: "Removido" };
  var CAMPO = { title: "Título", url: "Link", version: "Versão", note: "Observação" };

  /* ---------- HTML ---------- */
  function dh(o, x) { return x ? (o.fmt ? o.fmt(x) : String(x).replace("T", " ").slice(0, 16)) : ""; }
  function tipoOpts(sel) { return '<option value="">Escolha o tipo…</option>' + TIPOS.map(function (t) { return '<option value="' + esc(t) + '"' + (t === sel ? " selected" : "") + ">" + esc(t) + "</option>"; }).join(""); }
  function paiOpts(docs, tipo, sel, ignorar) {
    var l = (docs || []).filter(function (d) { return d.doc_type === tipo && String(d.id) !== String(ignorar); }).sort(porData);
    return '<option value="">Nenhum (documento novo)</option>' + l.map(function (d) {
      return '<option value="' + d.id + '"' + (String(d.id) === String(sel) ? " selected" : "") + ">" + esc(d.title + (d.version ? " (" + d.version + ")" : "")) + "</option>";
    }).join("");
  }
  function campoHtml(id, rotulo, ctrl, max, val, err, dica) {
    return '<div class="dc-f' + (err ? " has-err" : "") + '"><label for="' + id + '">' + rotulo + (max ? ' <span class="dc-cnt" data-cnt="' + id + '">' + String(val || "").length + "/" + max + "</span>" : "") + "</label>" + ctrl +
      (dica ? '<span class="hint">' + esc(dica) + "</span>" : "") + '<span class="dc-err" id="' + id + '-e" role="alert">' + (err ? esc(err) : "") + "</span></div>";
  }
  /* f: { modo: "novo"|"editar", id, v:{...}, erro:{campo,msg}, docs } */
  function formHtml(f) {
    var v = f.v || {}, e = f.erro || {}, ed = f.modo === "editar", er = function (c) { return e.campo === c ? e.msg : ""; };
    var tipoCtrl = ed ? '<input class="inp" id="dcf-type" value="' + esc(v.doc_type) + '" disabled>' :
      '<select class="sel" id="dcf-type" name="doc_type" required aria-describedby="dcf-type-e"' + (e.campo === "doc_type" ? ' aria-invalid="true"' : "") + ">" + tipoOpts(v.doc_type) + "</select>";
    var pai = ed ? "" : '<div class="dc-f dc-pai"><label for="dcf-parent">Nova versão de</label><select class="sel" id="dcf-parent" name="parent_id">' + paiOpts(f.docs, v.doc_type, v.parent_id) + '</select><span class="hint">Opcional. Liga este link ao anterior do mesmo tipo (v1 → v2).</span><span class="dc-err" id="dcf-parent-e" role="alert">' + er("parent_id") + "</span></div>";
    return '<form class="dc-form" data-dc-form="' + (ed ? "editar" : "novo") + '"' + (ed ? ' data-id="' + esc(f.id) + '"' : "") + ' novalidate aria-label="' + (ed ? "Editar documento" : "Adicionar documento") + '">' +
      '<div class="dc-form-h"><b>' + (ed ? "Editar documento" : v.parent_id ? "Nova versão" : "Adicionar documento") + '</b><span class="dc-ok" role="status" aria-live="polite"></span></div>' +
      (ed ? '<p class="hint dc-aviso">Cada alteração fica no histórico do item (antes e depois, quem e quando). O tipo não muda; para trocar de tipo, adicione outro documento.</p>' : "") +
      '<div class="dc-grid">' +
      campoHtml("dcf-title", "Título", '<input class="inp" id="dcf-title" name="title" maxlength="140" required autocomplete="off" value="' + esc(v.title) + '" aria-describedby="dcf-title-e"' + (e.campo === "title" ? ' aria-invalid="true"' : "") + ">", LIM.titulo[1], v.title, er("title")) +
      campoHtml("dcf-type", "Tipo", tipoCtrl, 0, "", er("doc_type")) +
      campoHtml("dcf-url", "Link (http ou https)", '<input class="inp" id="dcf-url" name="url" type="url" inputmode="url" maxlength="2000" required autocomplete="off" placeholder="https://…" value="' + esc(v.url) + '" aria-describedby="dcf-url-e"' + (e.campo === "url" ? ' aria-invalid="true"' : "") + ">", 0, "", er("url")) +
      campoHtml("dcf-version", "Versão (opcional)", '<input class="inp" id="dcf-version" name="version" maxlength="30" autocomplete="off" placeholder="v1, v2, zip10…" value="' + esc(v.version) + '" aria-describedby="dcf-version-e"' + (e.campo === "version" ? ' aria-invalid="true"' : "") + ">", LIM.versao, v.version, er("version")) +
      pai + "</div>" +
      campoHtml("dcf-note", "Observação (opcional)", '<textarea class="u-minh70" id="dcf-note" name="note" rows="2" maxlength="400" aria-describedby="dcf-note-e"' + (e.campo === "note" ? ' aria-invalid="true"' : "") + ">" + esc(v.note) + "</textarea>", LIM.nota, v.note, er("note")) +
      (e.campo === "geral" || e.campo === "card" ? '<p class="dc-err dc-geral" role="alert">' + esc(e.msg) + "</p>" : "") +
      '<div class="dc-row"><button type="submit" class="btn btn-sm btn-primary">' + (ed ? "Salvar alteração" : "Salvar") + '</button><button type="button" class="btn btn-sm" data-dc-acao="cancelar-form">Cancelar</button><span class="hint dc-teclas"><kbd>Enter</kbd> salva · <kbd>Esc</kbd> cancela</span></div></form>';
  }
  function cadeiaHtml(d, todos) {
    var c = cadeiaDe(todos, d.id); if (c.length < 2) return "";
    return '<ol class="dc-chain" aria-label="Cadeia de versões">' + c.map(function (x, i) {
      return '<li class="' + (x.id === d.id ? "cur" : "") + (x.removed_at ? " gone" : "") + '"' + (x.id === d.id ? ' aria-current="true"' : "") + ">" + esc(rotuloVersao(x, i)) + (x.removed_at ? " (removido)" : "") + "</li>";
    }).join('<li class="seta" aria-hidden="true">→</li>') + "</ol>";
  }
  function itemHtml(d, o, todos) {
    var ed = o.cw, st = o.st || {}, host = hostDe(d.url), cad = cadeiaHtml(d, todos);
    var h = '<li class="dc-i' + (d.atual ? " atual" : "") + '" data-doc="' + d.id + '">';
    h += '<div class="dc-top"><a class="dc-t" href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer" data-dc-acao="abrir">' + ico(IC.link) + "<span>" + esc(d.title) + "</span></a></div>";
    h += '<div class="dc-tags"><span class="tag dim">' + esc(d.doc_type) + "</span>" + (d.atual ? '<span class="tag ok">Atual</span>' : "") + (cad ? cad : d.version ? '<span class="tag acc">' + esc(d.version) + "</span>" : "") + "</div>";
    h += '<div class="dc-m"><span>' + esc(d.responsible || "") + "</span><span>" + esc(dh(o, d.created_at)) + "</span>" + (host ? '<span class="dc-host">' + esc(host) + "</span>" : "") + (d.updated_at && d.updated_at !== d.created_at ? '<span class="dc-ed" title="' + esc("Editado por " + (d.updated_by || "—") + " em " + dh(o, d.updated_at)) + '">editado</span>' : "") + "</div>";
    if (d.note) h += '<p class="dc-n">' + esc(d.note) + "</p>";
    if (st.confirmar === d.id) h += '<div class="dc-conf" role="alertdialog" aria-label="Abrir link externo"><p>Abrir link externo em nova aba?<br><b>' + esc(host || d.url) + '</b></p><div class="dc-row"><button type="button" class="btn btn-sm btn-primary" data-dc-acao="abrir-ok" data-url="' + esc(d.url) + '">Abrir</button><button type="button" class="btn btn-sm" data-dc-acao="abrir-nao">Cancelar</button></div></div>';
    h += '<div class="dc-a"><button type="button" class="btn btn-sm" data-dc-acao="abrir">' + ico(IC.open) + "Abrir</button><button type=\"button\" class=\"btn btn-sm\" data-dc-acao=\"copiar\">" + ico(IC.copy) + "Copiar link</button>";
    if (ed) h += '<button type="button" class="btn btn-sm" data-dc-acao="nova-versao">' + ico(IC.ver) + 'Nova versão</button><button type="button" class="btn btn-sm" data-dc-acao="editar">' + ico(IC.edit) + 'Editar</button><button type="button" class="btn btn-sm" data-dc-acao="historico" aria-expanded="' + (st.histId === d.id ? "true" : "false") + '">' + ico(IC.hist) + 'Histórico</button><button type="button" class="btn btn-sm btn-ghost dc-rm" data-dc-acao="remover">' + ico(IC.trash) + "Remover</button>";
    h += "</div>";
    if (st.remId === d.id) h += '<form class="dc-rem-f" data-dc-form="remover" data-id="' + d.id + '"><label for="dcr-' + d.id + '">Motivo da remoção <span class="dc-cnt" data-cnt="dcr-' + d.id + '">0/' + LIM.motivo + '</span></label><input class="inp" id="dcr-' + d.id + '" name="reason" maxlength="220" required autocomplete="off" aria-describedby="dcr-' + d.id + '-e"><span class="dc-err" id="dcr-' + d.id + '-e" role="alert">' + esc(st.remErro || "") + '</span><p class="hint">O item vai para “Documentos removidos”; nada é apagado de verdade.</p><div class="dc-row"><button type="submit" class="btn btn-sm btn-primary">Confirmar remoção</button><button type="button" class="btn btn-sm" data-dc-acao="cancelar-rem">Cancelar</button></div></form>';
    if (st.editId === d.id) h += formHtml({ modo: "editar", id: d.id, v: st.formV || d, erro: st.formErro, docs: o.docs });
    if (st.histId === d.id) h += histHtml(d, st.hist, o);
    return h + "</li>";
  }
  function mudancaHtml(c) {
    return Object.keys(c || {}).map(function (k) {
      var x = c[k] || {};
      return '<li><b>' + esc(CAMPO[k] || k) + ':</b> <span class="dc-de">' + esc(x.de == null || x.de === "" ? "(vazio)" : x.de) + '</span> <span aria-hidden="true">→</span><span class="sr-only"> para </span> <span class="dc-para">' + esc(x.para == null || x.para === "" ? "(vazio)" : x.para) + "</span></li>";
    }).join("");
  }
  function histHtml(d, hs, o) {
    if (!hs) return '<div class="dc-hist" role="region" aria-label="Histórico do item"><p class="hint">Carregando histórico…</p></div>';
    if (hs.erro) return '<div class="dc-hist" role="region" aria-label="Histórico do item"><p class="dc-err" role="alert">' + esc(hs.erro) + "</p></div>";
    var v = hs.versoes || [];
    var h = '<div class="dc-hist" role="region" aria-label="Histórico do item"><h4>Versões deste tipo na cadeia</h4>';
    h += v.length > 1 ? '<ol class="dc-chain">' + v.map(function (x, i) { return "<li" + (x.id === d.id ? ' class="cur"' : "") + ">" + esc(rotuloVersao(x, i) + (x.removed_at ? " (removido)" : "")) + "</li>"; }).join('<li class="seta" aria-hidden="true">→</li>') + "</ol>" : '<p class="hint">Sem outras versões ligadas a este item.</p>';
    h += "<h4>Edições (mais recente primeiro)</h4><ul class=\"dc-hl\">" + (hs.historico || []).map(function (x) {
      return '<li class="a-' + esc(x.action) + '"><div class="dc-hh"><b>' + esc(ACAO[x.action] || x.action) + "</b><span>" + esc(x.by || "") + " · " + esc(dh(o, x.at)) + "</span></div>" +
        (x.action === "edit" ? "<ul>" + mudancaHtml(x.changes) + "</ul>" : x.action === "remove" ? '<p class="dc-n">Motivo: ' + esc(x.reason || "") + "</p>" : x.after ? '<p class="dc-n">' + esc((x.after.title || "") + (x.after.version ? " · " + x.after.version : "") + " · " + (x.after.url || "")) + "</p>" : "") + "</li>";
    }).join("") + "</ul></div>";
    return h;
  }
  function removidosHtml(rem, o) {
    if (!rem || !rem.length) return "";
    return '<details class="dc-sub dc-removidos"><summary>Documentos removidos (' + rem.length + ')<span class="meta">só admin vê</span></summary><ul class="dc-list">' + rem.slice().sort(function (a, b) { return a.removed_at < b.removed_at ? 1 : -1; }).map(function (d) {
      var st = o.st || {};
      return '<li class="dc-i gone" data-doc="' + d.id + '"><div class="dc-top"><span class="dc-t">' + ico(IC.link) + "<span>" + esc(d.title) + '</span></span></div><div class="dc-tags"><span class="tag dim">' + esc(d.doc_type) + "</span>" + (d.version ? '<span class="tag acc">' + esc(d.version) + "</span>" : "") + '<span class="tag bad">Removido</span></div>' +
        '<div class="dc-m"><span>Removido por ' + esc(d.removed_by || "") + "</span><span>" + esc(dh(o, d.removed_at)) + '</span></div><p class="dc-n"><b>Motivo:</b> ' + esc(d.removal_reason || "") + '</p><p class="dc-n dim">' + esc(d.url) + '</p><div class="dc-a"><button type="button" class="btn btn-sm" data-dc-acao="historico" aria-expanded="' + (st.histId === d.id ? "true" : "false") + '">' + ico(IC.hist) + "Histórico</button></div>" + (st.histId === d.id ? histHtml(d, st.hist, o) : "") + "</li>";
    }).join("") + "</ul></details>";
  }
  /* o: { cw, adm, fmt, st:{aberto, carregando, erro, data, tipo, busca, form, editId, histId, hist, remId, confirmar, flash}, } */
  function blocoHtml(card, o) {
    o = o || {}; var st = o.st || {}, data = st.data, docs = data ? data.docs : [], rem = data && data.removidos || [], n = docs.length;
    var todos = docs.concat(rem); o.docs = docs;
    var h = '<details class="dblk dc" id="d-docs"' + (st.aberto ? " open" : "") + '><summary class="dblk-h"><h3 id="dc-h">' + ico(IC.doc) + "Documentos e links <span class=\"dc-n-tot\">(" + (st.carregando && !data ? "…" : n) + ')</span></h3><span class="meta">' + (st.erro ? "indisponível" : st.carregando && !data ? "carregando…" : n ? "links, versões e histórico" : "nenhum ainda") + "</span></summary>";
    h += '<div class="dc-body">';
    if (st.erro) return h + '<p class="tk-vazio">Não foi possível carregar os documentos agora. ' + esc(st.erro) + "</p></div></details>";
    if (o.cw) {
      h += st.form && st.form.modo === "novo" ? formHtml({ modo: "novo", v: st.form.v, erro: st.form.erro, docs: docs }) : '<div class="dc-novo"><button type="button" class="btn btn-sm btn-primary" data-dc-acao="novo">' + ico(IC.plus) + "Adicionar documento</button>" + (st.flash ? '<span class="dc-ok" role="status" aria-live="polite">' + esc(st.flash) + "</span>" : "") + "</div>";
    }
    if (n > 3 || st.tipo || st.busca) {
      h += '<div class="dc-filtros" role="search"><label class="dc-fl"><span class="sr-only">Filtrar por tipo</span><select class="sel" id="dc-tipo" data-dc-filtro="tipo" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>' + TIPOS.map(function (t) { return '<option value="' + esc(t) + '"' + (t === st.tipo ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + '</select></label>' +
        '<label class="dc-fl dc-grow"><span class="sr-only">Buscar por título ou observação</span><input class="inp" type="search" id="dc-busca" data-dc-filtro="busca" placeholder="Buscar por título ou observação" autocomplete="off" value="' + esc(st.busca) + '"></label></div>';
    }
    var vis = filtrar(docs, st.tipo, st.busca), sp = separar(vis);
    if (!n && !st.carregando) h += '<p class="tk-vazio">' + (o.cw ? "Nenhum link ainda. Cole o link da proposta, da cotação ou da ata para a equipe achar rápido." : "Sem documentos neste projeto.") + "</p>";
    else if (!vis.length) h += '<p class="tk-vazio">Nenhum documento com esse filtro.</p>';
    o.st = st;
    if (sp.atuais.length) h += '<ul class="dc-list" aria-label="Documentos atuais">' + sp.atuais.map(function (d) { return itemHtml(d, o, todos); }).join("") + "</ul>";
    if (sp.antigas.length) h += '<details class="dc-sub dc-versoes"' + (st.verAberto || st.editId || st.histId || st.remId ? " open" : "") + "><summary>Histórico de versões (" + sp.antigas.length + ')<span class="meta">versões anteriores</span></summary><ul class="dc-list">' + sp.antigas.map(function (d) { return itemHtml(d, o, todos); }).join("") + "</ul></details>";
    if (o.adm) h += removidosHtml(rem, o);
    return h + "</div></details>";
  }

  /* ---------- eventos ---------- */
  /* o: { raiz, card(), canWrite(), isAdmin(), fmt(x), toast(msg), read(path), write(method, path, body), onChange(n), render(), copiar(txt) } */
  function montar(o) {
    var S = {};  /* estado por card (a seção lembra filtro, aberto e formulários enquanto o app está aberto) */
    function est(id) { return (S[id] = S[id] || { aberto: false, tipo: "", busca: "", data: null, carregando: false, erro: "" }); }
    function st0(x) { return x.st; }
    function cur() { var c = o.card(); return c ? { c: c, st: est(c.id) } : null; }
    function html() { var x = cur(); if (!x) return ""; return blocoHtml(x.c, { cw: o.canWrite(), adm: o.isAdmin(), fmt: o.fmt, st: x.st }); }
    function pintar(foco) {
      var box = o.raiz.querySelector("#d-docs"), x = cur(); if (!box || !x) return;
      var ativo = document.activeElement, guarda = null, fm = box.querySelector(".dc-form");
      if (fm) { var vv = lerForm(fm); if (fm.getAttribute("data-dc-form") === "novo" && st0(x).form) st0(x).form.v = vv; else if (st0(x).editId) st0(x).formV = Object.assign({}, st0(x).formV || {}, vv); }
      if (!foco && box.contains(ativo) && ativo.id) guarda = { id: ativo.id, a: ativo.selectionStart, b: ativo.selectionEnd };
      var esq = box.scrollTop; box.outerHTML = html();
      var n = o.raiz.querySelector("#d-docs");
      if (foco) { var e = n.querySelector(foco); if (e) e.focus(); }
      else if (guarda) { var e2 = n.querySelector("#" + guarda.id); if (e2) { e2.focus(); try { e2.setSelectionRange(guarda.a, guarda.b); } catch (_) {} } }
      ligar(n);
    }
    function ligar(n) {
      var d = n || o.raiz.querySelector("#d-docs"); if (!d || d._dc) return; d._dc = 1;
      d.addEventListener("toggle", function (e) { var x = cur(); if (!x) return; if (e.target === d) x.st.aberto = d.open; else if (e.target.classList && e.target.classList.contains("dc-versoes")) x.st.verAberto = e.target.open; }, true);
    }
    function contar(x) { o.onChange(x.c.id, x.st.data ? x.st.data.docs.length : 0); }
    async function carregar(id) {
      var st = est(id); if (st.carregando) return; st.carregando = true; st.erro = "";
      try { st.data = await o.read("/api/cards/" + encodeURIComponent(id) + "/docs"); }
      catch (e) { st.erro = "(" + ((e && e.message) || "falha de rede") + ")"; }
      finally { st.carregando = false; }
      var x = cur(); if (x && String(x.c.id) === String(id)) { pintar(); contar(x); }
    }
    async function chamar(x, fn) { if (x.st.ocupado) return; x.st.ocupado = true; try { return await fn(); } finally { x.st.ocupado = false; } }
    function erroDe(e) { var p = (e && e.payload) || {}; return { campo: p.campo || "geral", msg: (e && e.message) || "Não salvou." }; }
    function achar(x, id) { var l = x.st.data ? x.st.data.docs.concat(x.st.data.removidos || []) : []; return l.filter(function (d) { return String(d.id) === String(id); })[0]; }
    function lerForm(f) { var v = {}; ["title", "doc_type", "url", "version", "note", "parent_id"].forEach(function (k) { var el = f.elements[k]; if (el) v[k] = el.value; }); return v; }
    function limpaForm(st) { st.form = null; st.editId = null; st.formV = null; st.formErro = null; }

    o.raiz.addEventListener("click", function (e) {
      var b = e.target.closest("[data-dc-acao]"); if (!b || !o.raiz.contains(b)) return;
      var x = cur(); if (!x) return; var st = x.st, li = b.closest("[data-doc]"), id = li && Number(li.getAttribute("data-doc")), d = id ? achar(x, id) : null, a = b.getAttribute("data-dc-acao");
      if (a === "abrir") { if (d) { e.preventDefault(); st.confirmar = d.id; pintar('[data-doc="' + d.id + '"] [data-dc-acao="abrir-ok"]'); } return; }
      if (a === "abrir-nao") { var i0 = st.confirmar; st.confirmar = null; pintar('[data-doc="' + i0 + '"] [data-dc-acao="abrir"]'); return; }
      if (a === "abrir-ok") { var w = g.open(b.getAttribute("data-url"), "_blank", "noopener,noreferrer"); if (w) w.opener = null; st.confirmar = null; pintar(); return; }
      if (a === "copiar") { if (d) o.copiar(d.url).then(function (ok) { o.toast(ok ? "Link copiado." : "Não deu para copiar. Selecione e copie o link manualmente."); }); return; }
      if (!o.canWrite()) return;
      if (a === "novo") { st.form = { modo: "novo", v: {} }; pintar("#dcf-title"); return; }
      if (a === "cancelar-form") { limpaForm(st); pintar(st.editId ? null : '[data-dc-acao="novo"]'); return; }
      if (a === "nova-versao" && d) {
        st.editId = null; st.form = { modo: "novo", v: { title: d.title, doc_type: d.doc_type, parent_id: String(d.id), version: proximaVersao(d.version) } };
        st.aberto = true; pintar("#dcf-url"); var f0 = o.raiz.querySelector("#d-docs .dc-form"); if (f0 && f0.scrollIntoView) f0.scrollIntoView({ block: "nearest" }); return;
      }
      if (a === "editar" && d) { st.form = null; st.editId = d.id; st.formV = null; st.formErro = null; pintar("#dcf-title"); return; }
      if (a === "remover" && d) { st.remId = d.id; st.remErro = ""; pintar("#dcr-" + d.id); return; }
      if (a === "cancelar-rem") { var i1 = st.remId; st.remId = null; pintar('[data-doc="' + i1 + '"] [data-dc-acao="remover"]'); return; }
      if (a === "historico" && d) {
        if (st.histId === d.id) { st.histId = null; st.hist = null; pintar('[data-doc="' + d.id + '"] [data-dc-acao="historico"]'); return; }
        st.histId = d.id; st.hist = null; pintar('[data-doc="' + d.id + '"] [data-dc-acao="historico"]');
        o.read("/api/docs/" + d.id + "/history").then(function (h) { if (st.histId === d.id) { st.hist = h; pintar(); } }).catch(function (er) { if (st.histId === d.id) { st.hist = { erro: (er && er.message) || "Não carregou o histórico." }; pintar(); } });
      }
    });
    o.raiz.addEventListener("submit", function (e) {
      var f = e.target.closest("[data-dc-form]"); if (!f || !o.raiz.contains(f)) return;
      e.preventDefault(); var x = cur(); if (!x || !o.canWrite()) return; var st = x.st, tipo = f.getAttribute("data-dc-form");
      if (tipo === "remover") {
        var id = Number(f.getAttribute("data-id")), motivo = f.elements.reason.value.replace(/\s+/g, " ").trim();
        if (!motivo) { st.remErro = "Diga o motivo da remoção."; pintar("#dcr-" + id); return; }
        if (motivo.length > LIM.motivo) { st.remErro = "Motivo com no máximo " + LIM.motivo + " caracteres."; pintar("#dcr-" + id); return; }
        chamar(x, async function () {
          try { await o.write("POST", "/api/docs/" + id + "/remove", { reason: motivo }); st.remId = null; st.remErro = ""; if (st.histId === id) { st.histId = null; st.hist = null; }
            await recarregar(x); st.flash = "✓ Removido"; pintar(); o.toast("Documento removido. Está em “Documentos removidos”.");
          } catch (er) { st.remErro = erroDe(er).msg; pintar("#dcr-" + id); }
        }); return;
      }
      var v = lerForm(f), novo = tipo === "novo", er0 = validar(v, novo);
      var alvo = novo ? null : Number(f.getAttribute("data-id"));
      function mostra(er) { if (novo) { st.form = { modo: "novo", v: v, erro: er }; } else { st.formV = Object.assign({}, achar(x, alvo), v); st.formErro = er; } pintar(er.campo === "geral" ? "#dcf-title" : "#dcf-" + ({ doc_type: "type", parent_id: "parent" }[er.campo] || er.campo)); }
      if (er0) { mostra(er0); return; }
      var corpo = { title: v.title, url: v.url, version: v.version || null, note: v.note || null };
      if (novo) { corpo.doc_type = v.doc_type; if (v.parent_id) corpo.parent_id = Number(v.parent_id); }
      chamar(x, async function () {
        try {
          if (novo) await o.write("POST", "/api/cards/" + encodeURIComponent(x.c.id) + "/docs", corpo);
          else await o.write("PATCH", "/api/docs/" + alvo, corpo);
          limpaForm(st); await recarregar(x); st.flash = "✓ Salvo"; st.aberto = true; pintar(novo ? '[data-dc-acao="novo"]' : '[data-doc="' + alvo + '"] [data-dc-acao="editar"]');
          if (st.histId === alvo && alvo) { var h = await o.read("/api/docs/" + alvo + "/history").catch(function () { return null; }); if (h) { st.hist = h; pintar(); } }
          o.toast("✓ Salvo"); setTimeout(function () { if (st.flash) { st.flash = ""; var c2 = cur(); if (c2 && c2.st === st) pintar(); } }, 3500);
        } catch (er) { mostra(erroDe(er)); }
      });
    });
    async function recarregar(x) { x.st.data = await o.read("/api/cards/" + encodeURIComponent(x.c.id) + "/docs"); contar(x); }
    /* Esc cancela (formulário, motivo, confirmação); Ctrl+Enter salva a observação; contador de caracteres ao digitar; "tipo" refaz a lista de "nova versão de". */
    o.raiz.addEventListener("keydown", function (e) {
      var f = e.target.closest && e.target.closest("[data-dc-form]");
      if (e.key === "Escape") {
        var x = cur(); if (!x) return;
        if (f) { e.stopPropagation(); e.preventDefault(); var b = f.querySelector('[data-dc-acao="cancelar-form"],[data-dc-acao="cancelar-rem"]'); if (b) b.click(); return; }
        if (x.st.confirmar != null && e.target.closest("#d-docs")) { e.stopPropagation(); var c = x.st.confirmar; x.st.confirmar = null; pintar('[data-doc="' + c + '"] [data-dc-acao="abrir"]'); }
      } else if (e.key === "Enter" && e.ctrlKey && f && e.target.tagName === "TEXTAREA") { e.preventDefault(); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }
    }, true);
    o.raiz.addEventListener("input", function (e) {
      var t = e.target; if (t.closest && t.closest("#d-docs")) {
        var c = t.id && o.raiz.querySelector('[data-cnt="' + t.id + '"]');
        if (c) { var mx = Number((/\/(\d+)$/.exec(c.textContent) || [])[1]); c.textContent = t.value.length + "/" + mx; c.classList.toggle("over", t.value.length > mx); }
        if (t.hasAttribute("data-dc-filtro")) { var x = cur(); if (x && t.getAttribute("data-dc-filtro") === "busca") { x.st.busca = t.value; pintar(); } }
        var er = t.id && o.raiz.querySelector("#" + t.id + "-e"); if (er && er.textContent && t.closest(".dc-form")) { er.textContent = ""; t.removeAttribute("aria-invalid"); }
      }
    });
    o.raiz.addEventListener("change", function (e) {
      var t = e.target; if (!t.closest || !t.closest("#d-docs")) return;
      if (t.getAttribute("data-dc-filtro") === "tipo") { var x = cur(); if (x) { x.st.tipo = t.value; pintar(); } }
      if (t.id === "dcf-type") { var p = o.raiz.querySelector("#dcf-parent"), x2 = cur(); if (p && x2) p.innerHTML = paiOpts(x2.st.data.docs, t.value, ""); }
      if (t.id === "dcf-parent" && t.value) { var x3 = cur(), pd = x3 && achar(x3, t.value), f = t.closest("form"); if (pd && f) { if (!f.elements.version.value) f.elements.version.value = proximaVersao(pd.version); if (!f.elements.title.value) f.elements.title.value = pd.title; } }
    });
    return { html: html, carregar: carregar, pintar: pintar, ligar: ligar, estado: est };
  }

  g.KanzoDocs = { TIPOS: TIPOS, LIM: LIM, hostDe: hostDe, cadeiaDe: cadeiaDe, filtrar: filtrar, separar: separar, proximaVersao: proximaVersao, validar: validar, blocoHtml: blocoHtml, formHtml: formHtml, montar: montar };
})(typeof window !== "undefined" ? window : globalThis);
