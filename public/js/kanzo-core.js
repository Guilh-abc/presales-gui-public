/* kanzo-core.js — regras de leitura do card ÚNICAS para o Worker (Cloudflare) e para o painel (navegador).
   O Worker importa este arquivo (import './public/js/kanzo-core.js') e o painel carrega como <script>.
   Sem dependências. Mudou aqui, mudou nos dois lados: não reimplementar em outro arquivo. byGui */
(function (g) {
  "use strict";
  var TZ = "America/Sao_Paulo";
  var ROTULO_RE = /^\s*\*\*([^*\n]{2,60}?):\*\*\s*(.*)$/;
  var IGNORA = /^(Notas|Checklist|Descrição|Título|\d{2}\/\d{2}\/\d{4})/i;

  function limpa(s) { return String(s || "").replace(/\*\*/g, "").replace(/`/g, "").trim(); }
  function numeroBR(s) {
    var m = String(s || "").match(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/);
    if (!m) return null;
    var v = parseFloat(m[0].replace(/\./g, "").replace(",", "."));
    return isFinite(v) ? v : null;
  }

  /* Pares "**Rótulo:** valor" (valor limpo de markdown), na ordem da descrição. */
  function rotulados(desc) {
    var out = [];
    String(desc || "").split("\n").forEach(function (linha) {
      var m = linha.match(ROTULO_RE); if (!m) return;
      var rot = m[1].trim(), val = limpa(m[2]);
      if (IGNORA.test(rot) || !val) return;
      out.push({ rotulo: rot, valor: val });
    });
    return out;
  }

  /* Prazo efetivo = "Prazo (Kanzo)" se existir; senão "Data de conclusão" das Datas Planner. */
  function prazos(desc) {
    var kanzo = null, planner = null;
    rotulados(desc).forEach(function (p) {
      if (/^Datas Planner/i.test(p.rotulo)) { var d = p.valor.match(/Data de conclus[aã]o:\s*(\d{4}-\d{2}-\d{2})/i); if (d) planner = d[1]; }
      else if (/^Prazo \(Kanzo\)$/i.test(p.rotulo)) { var k = p.valor.match(/(\d{4}-\d{2}-\d{2})/); if (k) kanzo = k[1]; }
    });
    return { kanzo: kanzo, planner: planner, prazo: kanzo || planner || null, fonte: kanzo ? "Kanzo" : planner ? "Planner" : null };
  }

  function hojeISO(agora) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(agora != null ? agora : Date.now())); }
  /* Dias inteiros entre hoje (Brasília) e AAAA-MM-DD. Negativo = vencido. */
  function diasAte(iso, agora) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(hojeISO(agora) + "T00:00:00Z")) / 86400000);
  }
  /* Atrasado = prazo efetivo (Kanzo > Planner) < hoje em Brasília e status != done.
     A tag "atrasado" do Planner NÃO é fonte da verdade. prazo opcional evita reler a descrição. */
  function isAtrasado(status, desc, agora, prazo) {
    if (status === "done") return false;
    var p = prazo !== undefined ? prazo : prazos(desc).prazo;
    var d = diasAte(p, agora);
    return d != null && d < 0;
  }

  /* TCV, MRC e OTC só de linhas de tabela markdown com rótulo explícito. Texto solto é ignorado: nada de chute. */
  function valoresDaDescricao(desc) {
    var out = { tcv: null, mrc: null, otc: null, prazo_meses: null, origem: {} };
    String(desc || "").split("\n").forEach(function (linha) {
      var l = linha.trim();
      if (l.charAt(0) !== "|") return;
      var cel = l.split("|").map(limpa).filter(function (c) { return c !== ""; });
      if (!cel.length) return;
      var rot = cel[0];
      var re = /R\$\s*-?[\d.]+(?:,\d+)?(\s*\/\s*m[eê]s)?/gi, m, vals = [], mensal = null;
      var bruto = limpa(l);
      while ((m = re.exec(bruto))) { var v = numeroBR(m[0]); vals.push(v); if (m[1]) mensal = v; }
      if (!vals.length) return;
      var ultimo = vals[vals.length - 1];
      var orig = bruto.replace(/\s*\|\s*/g, " | ").replace(/^\s*\|\s*|\s*\|\s*$/g, "");
      if (/^TCV\b/i.test(rot)) {
        out.tcv = ultimo; out.origem.tcv = orig;
        var pm = rot.match(/(\d+)\s*(?:m\b|meses)/i); if (pm) out.prazo_meses = +pm[1];
      } else if (/^MRC\b/i.test(rot)) { out.mrc = ultimo; out.origem.mrc = orig; }
      else if (/^OTC\b/i.test(rot)) { out.otc = ultimo; out.origem.otc = orig; }
      else if (/^TOTAL$/i.test(rot) && out.tcv == null) {
        out.tcv = ultimo; out.origem.tcv = orig;
        if (mensal != null && out.mrc == null) { out.mrc = mensal; out.origem.mrc = orig; }
      }
    });
    return out;
  }
  /* Formato da API (card.values): só campos presentes, com a linha de origem em tcv_line/mrc_line/otc_line. */
  function valoresApi(desc) {
    var v = valoresDaDescricao(desc), out = {};
    if (v.tcv != null) { out.tcv = v.tcv; out.tcv_line = v.origem.tcv; }
    if (v.mrc != null) { out.mrc = v.mrc; out.mrc_line = v.origem.mrc; }
    if (v.otc != null) { out.otc = v.otc; out.otc_line = v.origem.otc; }
    if (v.prazo_meses != null) out.prazo_meses = v.prazo_meses;
    return out;
  }

  /* Tags do Kanzo: "stage:x", "prioridade:y", "solucao:z", "rotulo:w". */
  function parseTags(tags) {
    if (Array.isArray(tags)) return tags.map(String).map(function (t) { return t.trim(); }).filter(Boolean);
    return String(tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function tagValor(tags, prefixo) {
    for (var i = 0; i < (tags || []).length; i++) if (tags[i].indexOf(prefixo) === 0) return tags[i].slice(prefixo.length);
    return null;
  }
  function stageFromTags(tags) { return tagValor(tags, "stage:"); }
  function prioridadeFromTags(tags) { return tagValor(tags, "prioridade:"); }
  function solutionFromTags(tags) { var s = tagValor(tags, "solucao:"); return s == null ? "A definir" : s; }
  function solutionFromDescription(desc) {
    var m = String(desc || "").match(/\*\*Solu[cç][aã]o \/ Escopo:\*\*\s*(.+)/i);
    return m ? m[1].split("\n")[0].trim() : null;
  }

  /* Motivo legível (PT-BR) de um comando que o Mac recusou ou não conseguiu aplicar (resultado do /sync/ack). */
  var ACAO = { delete_task: "Exclusão", update_task: "Edição", create_task: "Criação", add_comment: "Comentário" };
  function motivoFalha(op, erro) {
    var e = String(erro == null ? "" : erro), a = ACAO[op] || "Comando";
    if (/title mismatch/i.test(e)) return { recusado: true, motivo: a + " recusada pelo Mac: o título do card mudou no Kanzo" };
    if (/description hash mismatch|conflito/i.test(e)) return { recusado: true, motivo: a + " recusada pelo Mac: a descrição do card mudou no Kanzo" };
    if (/missing expected_/i.test(e)) return { recusado: true, motivo: a + " recusada pelo Mac: pedido sem dados de conferência (título/descrição)" };
    if (/not found|no task/i.test(e)) return { recusado: false, motivo: a + " não aplicada: o card não existe mais no Mac" };
    return { recusado: false, motivo: a + " falhou no Mac" + (e ? ": " + e.slice(0, 160) : "") };
  }

  /* Remodelo 11/11/2026: tarefas sugeridas por etapa (seed do Kiro, só as sugestões; nada obrigatório, o usuário marca ou dispensa).
     "satelite": só sugere quando a solução do card é SATELLITE / Starlink. Mesmo módulo no Worker (validação) e no painel. */
  var SUGESTOES_ETAPA = {
    "processo-de-cotacao": [{ key: "cot-solicitada", title: "Cotação solicitada ao fornecedor" }, { key: "cot-recebida", title: "Cotação recebida" }],
    "precificacao": [{ key: "pricing-montado", title: "Pricing net/gross montado" }, { key: "pricing-starlink", title: "Condições Starlink revisadas", satelite: true }],
    "processo-aprovacao-precificacao": [{ key: "pricing-aprovado", title: "Pricing aprovado" }],
    "apresentacao-executiva": [{ key: "proposta-enviada", title: "Proposta enviada ao cliente" }, { key: "feedback-registrado", title: "Feedback registrado no card", opcional: true }]
  };
  var RE_SATELITE = /starlink|satellite|sat[eé]lite/i;
  function sugestoesDaEtapa(stage, solucao) {
    return (SUGESTOES_ETAPA[stage] || []).filter(function (x) { return !x.satelite || RE_SATELITE.test(String(solucao || "")); })
      .map(function (x) { return { key: x.key, title: x.title, stage: stage, opcional: !!x.opcional }; });
  }
  function sugestaoPorChave(key) {
    for (var st in SUGESTOES_ETAPA) for (var i = 0; i < SUGESTOES_ETAPA[st].length; i++) if (SUGESTOES_ETAPA[st][i].key === key) return { key: key, title: SUGESTOES_ETAPA[st][i].title, stage: st };
    return null;
  }

  /* Perfil leitura (09/11, pedido do Guilherme): custo, margem e pricing interno saem da descrição antes de sair da API.
     Admin continua vendo tudo. Regras (conservadoras: na dúvida, corta):
     1) título markdown (#..######) de pricing interno / custo / margem / net / gross / indicadores: corta a seção inteira até o próximo título de nível igual ou maior
        (exceto títulos de valores AO CLIENTE / oficiais / proposta, que são o preço de venda);
     2) linha só em negrito ("**Governança (custo)**") com termo sensível: corta o bloco até a linha em branco;
     3) linha com termo sensível E número/valor (R$, %, dígito): corta a linha;
     4) cabeçalho sensível sem número seguido de linhas só de valores ("OTC MRC Total Cost" + "R$ … R$ …"): corta o cabeçalho e os valores.
     Campos estruturais (Solução, Responsáveis, Datas, Prazo, Saúde, Etapa, Status) nunca são cortados. */
  var SENS = /pricing\s+interno|\bcustos?\b|\bcost\b|\bmargem\b|\bmargin\b|\bnet\b|\bgross\b|\bmark-?up\b|\bGM\b|\bNPV\b|\bOE\b|\bOR\s*:|\bebitda\b|\brentabilidade\b|\blucro\b|cash\s*flow|\bimpostos?\b.*\d|\btax\b/i;
  var TITULO_SENS = /pricing\s+interno|\bcustos?\b|\bcost\b|\bmargem\b|\bmargin\b|\bnet\b|\bgross\b|indicadores|\bdtgbs\b/i;
  var TITULO_CLIENTE = /ao cliente|oficia|proposta comercial|valores \(kanzo\)/i;
  var VALOR = /R\$|US\$|€|\d/;
  var SO_VALORES = /^[\s|*R$US€\d.,%x×—–-]+$/;
  var ESTRUTURAL = /^\s*\*\*(Solu[cç][aã]o|Respons[aá]veis|Datas Planner|Prazo|Sa[uú]de|Etapa|Status|Prioridade|Est[aá]gio|Criado por)/i;
  var MARCA = "_[trecho interno (custo/margem/pricing) omitido no acesso de leitura]_";
  function descricaoLeitura(desc) {
    if (desc == null) return desc;
    var L = String(desc).split("\n"), out = [], i = 0, n = 0;
    function marca() { if (out[out.length - 1] !== MARCA) { out.push(MARCA); n++; } }
    while (i < L.length) {
      var l = L[i], h = l.match(/^\s*(#{1,6})\s+(.*)$/);
      if (ESTRUTURAL.test(l)) { out.push(l); i++; continue; }
      if (h && TITULO_SENS.test(h[2]) && !TITULO_CLIENTE.test(h[2])) {
        var nivel = h[1].length; i++;
        while (i < L.length) { var h2 = L[i].match(/^\s*(#{1,6})\s+/); if (h2 && h2[1].length <= nivel) break; i++; }
        marca(); continue;
      }
      if (/^\s*\*\*[^*]+\*\*:?\s*$/.test(l) && SENS.test(l)) {
        i++; while (i < L.length && L[i].trim() !== "" && !/^\s*#{1,6}\s/.test(L[i]) && !/^\s*\*\*[^*]+\*\*:?\s*$/.test(L[i])) i++;
        marca(); continue;
      }
      if (SENS.test(l) && VALOR.test(l)) { marca(); i++; continue; }
      if (SENS.test(l) && !VALOR.test(l) && i + 1 < L.length && SO_VALORES.test(L[i + 1]) && /R\$|US\$|€/.test(L[i + 1])) {
        i++; while (i < L.length && SO_VALORES.test(L[i]) && /R\$|US\$|€/.test(L[i])) i++;
        marca(); continue;
      }
      out.push(l); i++;
    }
    return n ? out.join("\n") : String(desc);
  }
  /* Texto curto qualquer (trechos de evidência do snapshot): some inteiro se tiver termo sensível com valor. */
  function trechoLeitura(t) { return typeof t === "string" && SENS.test(t) && VALOR.test(t) ? "[trecho interno omitido]" : t; }

  g.KanzoCore = {
    descricaoLeitura: descricaoLeitura, trechoLeitura: trechoLeitura,
    motivoFalha: motivoFalha, SUGESTOES_ETAPA: SUGESTOES_ETAPA, sugestoesDaEtapa: sugestoesDaEtapa, sugestaoPorChave: sugestaoPorChave,
    TZ: TZ, limpa: limpa, numeroBR: numeroBR, rotulados: rotulados, prazos: prazos, hojeISO: hojeISO, diasAte: diasAte,
    isAtrasado: isAtrasado, valoresDaDescricao: valoresDaDescricao, valoresApi: valoresApi,
    parseTags: parseTags, tagValor: tagValor, stageFromTags: stageFromTags, prioridadeFromTags: prioridadeFromTags,
    solutionFromTags: solutionFromTags, solutionFromDescription: solutionFromDescription
  };
})(typeof window !== "undefined" ? window : globalThis);
