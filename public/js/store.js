/* Motor de edição: optimistic UI, autosave com debounce, retry com espera crescente,
   detecção de conflito por campo (base x Kanzo x seu valor), proteção contra o espelho voltar
   o valor antigo antes do Mac aplicar, histórico das últimas 15 edições e desfazer.
   Sem DOM: testável em node. byGui */
(function (g) {
  "use strict";
  var FL = g.KanzoFields;
  var MAX_HIST = 15, CHAVE_PEND = "kanzo.v3.pend", CHAVE_HIST = "kanzo.v3.hist", VIDA_SALVO_MS = 24 * 3600 * 1000;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  async function sha256(txt) {
    var c = g.crypto && g.crypto.subtle; if (!c) return null;
    return hex(await c.digest("SHA-256", new TextEncoder().encode(String(txt || ""))));
  }
  function retentavel(e) { return !e || e.status == null || e.status === 0 || e.status === 429 || e.status >= 500; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function create(o) {
    o = o || {};
    var api = o.api, agora = o.now || function () { return Date.now(); };
    var setT = o.setTimeout || function (f, ms) { return setTimeout(f, ms); }, clearT = o.clearTimeout || function (t) { clearTimeout(t); };
    var debounceMs = o.debounceMs != null ? o.debounceMs : 450, esperas = o.retries || [800, 2500, 6000];
    var store = o.storage || null, autor = o.autor || function () { return "você"; }, avisar = o.onChange || function () {};
    var maxConc = o.concorrencia || 3;
    var pend = {}, hist = [], timers = {}, travas = {}, sujo = {}, fila = [], ativos = 0, seq = 1;

    function carregar() {
      if (!store) return;
      try {
        var p = JSON.parse(store.getItem(CHAVE_PEND) || "{}"), h = JSON.parse(store.getItem(CHAVE_HIST) || "[]");
        Object.keys(p).forEach(function (id) {
          Object.keys(p[id]).forEach(function (f) {
            var e = p[id][f];
            if (!FL.FIELDS[f]) return;
            if (e.state === "applied") return;
            if (e.state === "saved" && agora() - (e.savedAt || 0) > VIDA_SALVO_MS) return;
            if (e.state === "saving" || e.state === "retry") e.state = "local";
            (pend[id] = pend[id] || {})[f] = e;
          });
        });
        hist = Array.isArray(h) ? h.slice(0, MAX_HIST) : [];
        hist.forEach(function (x) { if (x.id >= seq) seq = x.id + 1; });
      } catch (_) { pend = {}; hist = []; }
    }
    function gravar() {
      if (!store) return;
      try {
        var p = {};
        Object.keys(pend).forEach(function (id) { Object.keys(pend[id]).forEach(function (f) { var e = pend[id][f]; if (e.state !== "applied") (p[id] = p[id] || {})[f] = e; }); });
        store.setItem(CHAVE_PEND, JSON.stringify(p)); store.setItem(CHAVE_HIST, JSON.stringify(hist));
      } catch (_) {}
    }
    function mudou(tipo, id, f) { gravar(); try { avisar({ tipo: tipo, id: id, campo: f, entrada: f && pend[id] ? pend[id][f] : null }); } catch (_) {} }

    function entrada(id, f) { return pend[id] && pend[id][f]; }
    function valorServidor(card, f) { return FL.ler(card, f); }
    function visivel(e) { return e && e.state !== "error" && e.state !== "conflict"; }
    function efetivo(card) {
      var p = pend[card.id]; if (!p) return card;
      var desc = card.description, sol = null, marcas = {};
      Object.keys(p).forEach(function (f) {
        var e = p[f]; marcas[f] = e.state;
        if (!visivel(e)) return;
        try { desc = FL.set(desc, f, e.value); if (f === "solucao") sol = FL.normaliza(f, e.value) || "A definir"; } catch (_) {}
      });
      return Object.assign({}, card, { description: desc, solution: sol != null ? sol : card.solution, _pend: marcas });
    }
    function valorAtual(card, f) { var e = entrada(card.id, f); return visivel(e) ? e.value : valorServidor(card, f); }

    /* Editar: aplica na tela na hora e agenda o salvamento. */
    function edit(card, f, valor, op) {
      op = op || {};
      if (!FL.FIELDS[f]) throw new Error("campo desconhecido");
      var ed = FL.editavel(efetivo(card).description, f); if (!ed.ok) throw new Error(ed.motivo || "campo só leitura");
      var e = entrada(card.id, f), antes = valorAtual(card, f);
      valor = FL.normaliza(f, valor);
      if (FL.FIELDS[f].kind === "money" && typeof valor === "number" && !isFinite(valor)) throw new Error("valor inválido");
      if (e && e.state === "local" && e.histAntes !== undefined && FL.igual(f, valor, e.histAntes) && !(e.reenvios > 0)) {
        if (e.savedAt) { e.value = valor; e.state = "saved"; } else delete pend[card.id][f];
        mudou("cancelado", card.id, f); return false;
      }
      if (FL.igual(f, valor, antes) && (!e || e.state === "saved" || e.state === "applied" || e.state === "local")) return false;
      if (!e || e.state === "applied") e = { campo: f, base: valorServidor(card, f), histAntes: antes, rev: 0, tries: 0 };
      else if (e.state === "saved") { e.base = e.value; e.histAntes = antes; }
      else if (e.state === "error" || e.state === "conflict") { e.base = e.state === "conflict" && e.server !== undefined ? e.server : valorServidor(card, f); e.histAntes = antes; }
      e.value = valor; e.rev = (e.rev || 0) + 1; e.at = agora(); e.by = autor(); e.titulo = card.title;
      e.origem = op.origem || e.origem || "edicao"; e.lote = op.lote || null; e.error = null; e.server = undefined;
      if (e.state !== "saving") e.state = "local";
      (pend[card.id] = pend[card.id] || {})[f] = e;
      mudou("editado", card.id, f);
      agendar(card.id, op.imediato ? 0 : debounceMs);
      return true;
    }
    function agendar(id, ms) {
      clearT(timers[id]);
      timers[id] = setT(function () { timers[id] = null; enfileirar(id); }, ms);
    }
    function enfileirar(id) { if (fila.indexOf(id) < 0) fila.push(id); proximo(); }
    function proximo() {
      while (ativos < maxConc && fila.length) {
        var id = fila.shift(); ativos++;
        salvar(id).catch(function () {}).then(function () { ativos--; proximo(); });
      }
    }
    function flush(id) {
      var ids = id != null ? [String(id)] : Object.keys(pend);
      return Promise.all(ids.map(function (x) { clearT(timers[x]); timers[x] = null; return salvar(x); }));
    }

    async function salvar(id, tentativa409) {
      id = String(id);
      if (travas[id]) { sujo[id] = true; return travas[id]; }
      var p = pend[id]; if (!p) return;
      var lote = Object.keys(p).filter(function (f) { return p[f].state === "local"; });
      if (!lote.length) return;
      var revs = {};
      lote.forEach(function (f) { p[f].state = "saving"; revs[f] = p[f].rev; });
      mudou("salvando", id);
      var feito = (async function () {
        try {
          var fresh = await api.get(id);
          var desc = fresh.description || "", envia = [];
          lote.forEach(function (f) {
            var e = p[f], sv = FL.ler(fresh, f);
            if (e.base !== undefined && !FL.igual(f, sv, e.base) && !FL.igual(f, sv, e.value)) { e.state = "conflict"; e.server = sv; mudou("conflito", id, f); }
            else envia.push(f);
          });
          var novo = desc;
          Object.keys(p).forEach(function (f) { var e = p[f]; if (e.state === "saving" || e.state === "saved") novo = FL.set(novo, f, e.value); });
          if (!envia.length) return;
          var body = { description: novo };
          if (envia.indexOf("solucao") >= 0) body.solution = FL.normaliza("solucao", p.solucao.value) || "A definir";
          var h = await sha256(desc); if (h) body.expect_description_sha256 = h;
          if (novo !== desc || body.solution) await api.patch(id, body);
          var t = agora();
          envia.forEach(function (f) {
            var e = p[f];
            if (e.histAntes === undefined || !FL.igual(f, e.histAntes, e.value)) {
              hist.unshift({ id: seq++, cardId: id, titulo: e.titulo, campo: f, antes: e.histAntes, depois: e.value, at: t, by: e.by, origem: e.origem, lote: e.lote });
              if (hist.length > MAX_HIST) hist.length = MAX_HIST;
            }
            e.histAntes = e.value; e.tries = 0; e.savedAt = t; e.reenvios = e.reenvios || 0;
            e.state = e.rev !== revs[f] ? "local" : "saved";
            if (e.state === "local") sujo[id] = true;
          });
          mudou("salvo", id);
        } catch (err) {
          if (err && err.status === 409 && !tentativa409) {
            lote.forEach(function (f) { if (p[f].state === "saving") p[f].state = "local"; });
            travas[id] = null; return salvar(id, true);
          }
          var tries = Math.max.apply(null, lote.map(function (f) { return p[f].tries || 0; }));
          lote.forEach(function (f) {
            var e = p[f]; if (e.state !== "saving") return;
            e.error = (err && err.message) || "Falha ao salvar";
            if (retentavel(err) && tries < esperas.length) { e.state = "retry"; e.tries = tries + 1; e.proxima = agora() + esperas[tries]; }
            else { e.state = "error"; e.tries = tries + 1; }
          });
          var algum = lote.some(function (f) { return p[f].state === "retry"; });
          if (algum) setT(function () { lote.forEach(function (f) { if (p[f] && p[f].state === "retry") p[f].state = "local"; }); enfileirar(id); }, esperas[tries]);
          mudou(algum ? "tentando" : "erro", id);
        }
      })();
      travas[id] = feito;
      try { await feito; } finally {
        if (travas[id] === feito) travas[id] = null;
        if (sujo[id]) { sujo[id] = false; agendar(id, 0); }
      }
    }

    /* Depois de cada leitura da API: confirma o que o Kanzo já aplicou e detecta o que se perdeu. */
    function reconciliar(cards, sync) {
      var porId = {}; (cards || []).forEach(function (c) { porId[String(c.id)] = c; });
      var lastPush = sync && sync.last_push_at ? Date.parse(sync.last_push_at) : 0, mudouAlgo = false;
      Object.keys(pend).forEach(function (id) {
        var c = porId[id]; if (!c) { delete pend[id]; mudouAlgo = true; return; } // card removido: não fica esperando para sempre
        Object.keys(pend[id]).forEach(function (f) {
          var e = pend[id][f]; if (e.state !== "saved") return;
          var sv = FL.ler(c, f);
          if (FL.igual(f, sv, e.value)) { if (!c.pending) { e.state = "applied"; e.appliedAt = agora(); mudouAlgo = true; } return; }
          if (c.pending || !lastPush || lastPush <= (e.savedAt || 0) || (sync && sync.pending_commands)) return;
          if (FL.igual(f, sv, e.base) && (e.reenvios || 0) < 1) { e.reenvios = (e.reenvios || 0) + 1; e.state = "local"; e.aviso = "O app não recebeu a alteração. Reenviando."; agendar(id, 0); }
          else if (FL.igual(f, sv, e.base)) { e.state = "error"; e.error = "O app não gravou esta alteração."; }
          else { e.state = "conflict"; e.server = sv; }
          mudouAlgo = true;
        });
      });
      if (mudouAlgo) mudou("reconciliado");
    }
    function limparAplicados() {
      var t = agora(), mudouAlgo = false;
      Object.keys(pend).forEach(function (id) { Object.keys(pend[id]).forEach(function (f) { var e = pend[id][f]; if (e.state === "applied" && t - (e.appliedAt || 0) > 4000) { delete pend[id][f]; mudouAlgo = true; } }); if (!Object.keys(pend[id]).length) delete pend[id]; });
      if (mudouAlgo) mudou("limpo");
    }
    function resolver(card, f, escolha) {
      var e = entrada(card.id, f); if (!e || e.state !== "conflict") return;
      if (escolha === "kanzo") { delete pend[card.id][f]; mudou("resolvido", card.id, f); return; }
      e.base = e.server; e.state = "local"; e.server = undefined; e.error = null; mudou("resolvido", card.id, f); agendar(card.id, 0);
    }
    function tentarDeNovo(id) { var p = pend[id]; if (!p) return; Object.keys(p).forEach(function (f) { if (p[f].state === "error") { p[f].state = "local"; p[f].tries = 0; p[f].error = null; } }); mudou("retry", id); agendar(id, 0); }
    function descartar(id, f) { if (pend[id]) { delete pend[id][f]; if (!Object.keys(pend[id]).length) delete pend[id]; } mudou("descartado", id, f); }
    function desfazer(hid, cardsPorId, loteInteiro) {
      var h = hist.filter(function (x) { return x.id === hid; })[0]; if (!h) return 0;
      var alvos = loteInteiro && h.lote ? hist.filter(function (x) { return x.lote === h.lote; }) : [h], n = 0;
      alvos.forEach(function (x) { var c = cardsPorId[x.cardId]; if (c) { try { if (edit(c, x.campo, x.antes, { imediato: true, origem: "desfazer" })) n++; } catch (_) {} } });
      return n;
    }
    function resumo() {
      var r = { local: 0, saving: 0, retry: 0, saved: 0, applied: 0, error: 0, conflict: 0 };
      Object.keys(pend).forEach(function (id) { Object.keys(pend[id]).forEach(function (f) { r[pend[id][f].state] = (r[pend[id][f].state] || 0) + 1; }); });
      return r;
    }
    function pendencias() {
      var out = []; Object.keys(pend).forEach(function (id) { Object.keys(pend[id]).forEach(function (f) { out.push(Object.assign({ cardId: id }, pend[id][f])); }); }); return out;
    }
    carregar();
    return { edit: edit, flush: flush, salvar: salvar, efetivo: efetivo, valorAtual: valorAtual, entrada: entrada, reconciliar: reconciliar, limparAplicados: limparAplicados,
      resolver: resolver, tentarDeNovo: tentarDeNovo, descartar: descartar, desfazer: desfazer, resumo: resumo, pendencias: pendencias,
      historico: function () { return hist.slice(); }, _pend: function () { return clone(pend); } };
  }
  g.KanzoStore = { create: create, sha256: sha256, MAX_HIST: MAX_HIST };
})(typeof window !== "undefined" ? window : globalThis);
