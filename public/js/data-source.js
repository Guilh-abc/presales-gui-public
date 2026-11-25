(function (global) {
  const API = {
    health: "/api/saude",
    healthAlt: "/api/health",
    cards: "/api/cards",
    stages: "/api/stages",
    summary: "/api/summary?action_all=1",
    sync: "/api/sync/status",
    me: "/api/me",
  };

  function redirectLogin() {
    if (global.location && !/\/login$/.test(global.location.pathname)) {
      global.location.replace("/login");
    }
  }

  async function tryFetch(url, opts) {
    opts = opts || {};
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.method && opts.method !== "GET" && opts.method !== "HEAD") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      headers["X-MCO"] = "1";
    }
    const init = Object.assign({}, opts, { credentials: "same-origin", headers: headers });
    const res = await fetch(url, init);
    if (res.status === 401) { redirectLogin(); const e = new Error("Entre para continuar."); e.status = 401; throw e; }
    if (!res.ok) {
      let err = { error: res.statusText, erro: res.statusText, code: res.status };
      try { err = Object.assign(err, await res.json()); } catch (_) {}
      const e = new Error(err.erro || err.error || ("HTTP " + res.status));
      e.payload = err; e.status = res.status; throw e;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function mapCard(c) {
    const tags = c.tags || [];
    const labels = tags.filter(function (t) { return String(t).indexOf("rotulo:") === 0; }).map(function (t) { return t.slice(7); });
    const prioridade = c.prioridade || c.priority || null;
    return Object.assign({}, c, {
      priority: prioridade,
      labels: labels,
      solution: c.solution || "A definir",
      values: c.values || {},
      active: c.active !== false && !c.deleted_at,
      stage_label: c.stage_label || c.stage,
      status_label: c.status_label || c.status,
      comments: c.comments || [],
    });
  }

  async function load() {
    try {
      if (global.location && global.location.protocol === "file:") throw new Error("file-protocol-snapshot");
      let health;
      try { health = await tryFetch(API.health); } catch (_) { health = await tryFetch(API.healthAlt); }
      const me = await tryFetch(API.me);
      let sync = null;
      try { sync = await tryFetch(API.sync); } catch (_) {}
      const cardsPayload = await tryFetch(API.cards + "?limit=500");
      let stagesPayload = {};
      try { stagesPayload = await tryFetch(API.stages); } catch (_) {}
      let summary = {};
      try { summary = await tryFetch(API.summary); } catch (_) {}
      const rawCards = Array.isArray(cardsPayload) ? cardsPayload : (cardsPayload.cards || []);
      const stagesRaw = Array.isArray(stagesPayload) ? stagesPayload : (stagesPayload.stages || []);
      const stages = stagesRaw.map(function (s, i) {
        if (typeof s === "string") return { key: s, label: s, order: i };
        return { key: s.key || s.id, label: s.label || s.key || s.id, order: s.order != null ? s.order : i, count: s.count, open: s.open };
      });
      return {
        source: "api",
        live: true,
        me: me,
        sync: sync,
        meta: Object.assign({}, cardsPayload.meta || {}, summary.project || {}, {
          health: health,
          project_name: (summary.project && summary.project.name) || "Pré-vendas",
          sync: sync,
          last_snapshot_at: sync && sync.last_snapshot_at,
          can_write: !!(me && me.papel === "admin"),
        }),
        stages: stages,
        statuses: ["todo", "doing", "review", "done"],
        cards: rawCards.map(mapCard),
        focus_ids: (summary.action_now || []).map(function (a) { return a.id; }),
        gaps: {},
        label: sync && sync.app_only === false && sync.mac_online ? "ao vivo · Mac online" : "ao vivo",
      };
    } catch (err) {
      if (err && err.status === 401) throw err;
      // Lote 0: o snapshot (139 KB) só é baixado quando a API falha.
      if (!global.KANZO_SNAPSHOT) { try { await carregarSnapshot(); } catch (_) { throw err; } }
      if (!global.KANZO_SNAPSHOT) throw err;
      const snap = global.KanzoData.normalizeSnapshot(global.KANZO_SNAPSHOT);
      snap.fallbackError = String(err.message || err);
      return snap;
    }
  }

  function carregarSnapshot() {
    return new Promise(function (ok, falha) {
      if (!global.document) return falha(new Error("sem documento"));
      var s = global.document.createElement("script");
      s.src = "js/dados-kanzo.js"; s.async = true;
      s.onload = function () { ok(); }; s.onerror = function () { falha(new Error("snapshot indisponível")); };
      global.document.head.appendChild(s);
    });
  }

  async function write(method, path, body) {
    const out = await tryFetch(path, {
      method: method,
      headers: { "Content-Type": "application/json", "X-MCO": "1" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    // normalize create response
    if (out && out.card) return out.card;
    return out;
  }

  function normalizeSnapshot(snap) {
    const cards = (snap.cards || []).map(function (c) {
      return Object.assign({}, c, { active: c.active !== false, deleted_at: c.deleted_at || null });
    });
    return {
      source: "snapshot", live: false, me: null, sync: null,
      meta: snap.meta || {}, stages: snap.stages || [], statuses: snap.statuses || [],
      cards: cards, focus_ids: snap.focus_ids || [], gaps: snap.gaps || {},
      label: "snapshot de " + ((snap.meta && snap.meta.exported_at_brt) || "data desconhecida"),
    };
  }

  global.KanzoData = { API: API, load: load, carregarSnapshot: carregarSnapshot, write: write, tryFetch: tryFetch, normalizeSnapshot: normalizeSnapshot };
})(window);
