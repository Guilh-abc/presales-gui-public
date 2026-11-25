/* Campos editáveis do card. Tudo mora na descrição do card no Kanzo (linhas "**Rótulo:** valor"
   e uma tabela de valores). Funções puras: ler, gravar (upsert), validar e dizer o que falta. byGui */
(function (g) {
  "use strict";
  var F = g.KanzoFmt;
  var GANHO = { "ganho-handoff": 1, "entregue-faturado": 1 };
  var BLOCO_VALORES = "**Valores (Kanzo):**";

  /* rótulo gravado, regex que reconhece rótulos já existentes (vindos do Planner ou do Kanzo) */
  var FIELDS = {
    solucao: { label: "Solução / escopo", kind: "text", line: "Solução / Escopo", re: /^Solu[cç][aã]o\s*\/\s*Escopo$/i, quality: "solucao",
      hint: "Escopo explícito do projeto, ex.: Starlink / Satélite. Vale o que está combinado com o cliente." },
    responsaveis: { label: "Responsáveis", kind: "people", line: "Responsáveis", re: /^Respons[aá]veis?$/i, quality: "responsavel",
      hint: "Pessoas da equipe. A lista sugere quem já aparece em outros cards." },
    prazo: { label: "Prazo", kind: "date", line: "Prazo (Kanzo)", re: /^Prazo \(Kanzo\)$/i, quality: "prazo",
      hint: "Data de conclusão combinada. Grava “Prazo (Kanzo)” e mantém as Datas Planner originais como histórico." },
    tcv: { label: "TCV", kind: "money", row: "TCV", quality: "valor", hint: "Valor total do contrato. Aceita 69.033,32, 69033.32, 69 mil ou 1,2 mi." },
    mrc: { label: "MRC", kind: "money", row: "MRC", suffix: "/mês", hint: "Receita mensal recorrente." },
    otc: { label: "OTC", kind: "money", row: "OTC", hint: "Receita única (instalação, equipamento)." },
    saude: { label: "Saúde", kind: "text", line: "Saúde", re: /^Sa[uú]de$/i, options: ["No prazo", "Atenção", "Em risco", "Bloqueado"],
      hint: "Como o projeto está agora, em uma palavra." },
    situacao: { label: "Situação atual", kind: "longtext", line: "Situação atual", re: /^Situa[cç][aã]o( atual)?$/i, hint: "O que aconteceu por último." },
    proxima: { label: "Próxima ação", kind: "longtext", line: "Próxima ação", re: /^Pr[oó]xima a[cç][aã]o(\s*\/.*)?$/i, hint: "O próximo passo concreto e de quem é." }
  };
  var ORDEM = ["solucao", "tcv", "prazo", "responsaveis", "saude", "situacao", "proxima", "mrc", "otc"];
  var QUALIDADE = [
    { id: "solucao", t: "Solução a definir", d: "Escopo não identificado no card", field: "solucao" },
    { id: "valor", t: "Sem valor registrado", d: "Abertos ou ganhos sem TCV", field: "tcv" },
    { id: "prazo", t: "Abertos sem prazo", d: "Sem data de conclusão", field: "prazo" },
    { id: "responsavel", t: "Sem responsável", d: "Ninguém no campo Responsáveis", field: "responsaveis" }
  ];

  function linhas(desc) { return String(desc == null ? "" : desc).split("\n"); }
  function rotuloDe(l) { var m = l.match(/^\s*\*\*([^*\n]{2,60}?):\*\*\s*(.*)$/); return m ? { rot: m[1].trim(), val: m[2] } : null; }
  function limpa(s) { return String(s || "").replace(/\*\*/g, "").replace(/`/g, "").trim(); }
  function umaLinha(v) { return String(v == null ? "" : v).replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim(); }

  /* ---------- dinheiro ---------- */
  function parseDinheiro(txt) {
    var s = String(txt == null ? "" : txt).trim().toLowerCase().replace(/r\$\s*/g, "").replace(/\s+/g, " ");
    if (!s) return null;
    var mult = 1, m = s.match(/^(-?[\d.,]+)\s*(mil|k|mi|mm|milh[oõ]es|milh[aã]o)?$/);
    if (!m) return NaN;
    if (m[2]) mult = /^(mil|k)$/.test(m[2]) ? 1e3 : 1e6;
    var n = m[1], v;
    if (/,\d{1,2}$/.test(n) || (n.indexOf(",") >= 0 && n.indexOf(".") >= 0 && n.lastIndexOf(",") > n.lastIndexOf("."))) v = parseFloat(n.replace(/\./g, "").replace(",", "."));
    else if (/^\d{1,3}(\.\d{3})+$/.test(n)) v = parseFloat(n.replace(/\./g, ""));
    else if (n.indexOf(",") >= 0 && mult > 1) v = parseFloat(n.replace(",", "."));
    else v = parseFloat(n.replace(/,/g, ""));
    if (!isFinite(v)) return NaN;
    return Math.round(v * mult * 100) / 100;
  }
  function fmtDinheiro(v) {
    var neg = v < 0, a = Math.abs(Math.round(v * 100)), int = String(Math.floor(a / 100)), dec = String(a % 100);
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + "R$ " + int + "," + (dec.length < 2 ? "0" + dec : dec);
  }

  /* ---------- leitura ---------- */
  function idxValores(ls) { for (var i = 0; i < ls.length; i++) if (ls[i].trim() === BLOCO_VALORES) return i; return -1; }
  function linhasDoBloco(ls) {
    var i = idxValores(ls), out = [];
    if (i < 0) return out;
    for (var j = i + 1; j < ls.length; j++) { var t = ls[j].trim(); if (t === "" && out.length) break; if (t === "") continue; if (t.charAt(0) !== "|") break; out.push(j); }
    return out;
  }
  /* Valor de dinheiro + de onde veio: "bloco" (editável aqui), "proposta" (tabela da proposta, só leitura) ou null */
  function dinheiro(desc, key) {
    var v = F.valoresDaDescricao(desc), ls = linhas(desc), bloco = linhasDoBloco(ls), deBloco = false;
    var re = new RegExp("^\\|\\s*\\**" + FIELDS[key].row + "\\b", "i");
    bloco.forEach(function (j) { if (re.test(ls[j].trim())) deBloco = true; });
    if (v[key] == null) return { value: null, origem: null };
    return { value: v[key], origem: deBloco ? "bloco" : "proposta", linha: v.origem[key] };
  }
  function get(desc, key) {
    var f = FIELDS[key]; if (!f) throw new Error("campo desconhecido: " + key);
    if (f.kind === "money") return dinheiro(desc, key).value;
    if (key === "prazo") return prazo(desc).value;
    var ls = linhas(desc);
    for (var i = 0; i < ls.length; i++) {
      var r = rotuloDe(ls[i]);
      if (r && f.re.test(r.rot)) {
        var val = limpa(r.val);
        if (f.kind === "people") return val ? val.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [];
        return val;
      }
    }
    return f.kind === "people" ? [] : "";
  }
  /* Prazo efetivo: "Prazo (Kanzo)" vence; senão a "Data de conclusão" das Datas Planner */
  function prazo(desc) {
    var ls = linhas(desc), kanzo = null, planner = null;
    ls.forEach(function (l) {
      var r = rotuloDe(l); if (!r) return;
      if (FIELDS.prazo.re.test(r.rot)) { var m = limpa(r.val).match(/(\d{4}-\d{2}-\d{2})/); if (m) kanzo = m[1]; }
      else if (/^Datas Planner/i.test(r.rot)) { var d = r.val.match(/Data de conclus[aã]o:\s*(\d{4}-\d{2}-\d{2})/i); if (d) planner = d[1]; }
    });
    return { value: kanzo || planner || "", fonte: kanzo ? "Kanzo" : planner ? "Planner" : null, planner: planner, kanzo: kanzo };
  }

  /* ---------- gravação ---------- */
  function fimDoCabecalho(ls) {
    var fim = -1;
    for (var i = 0; i < ls.length; i++) {
      var t = ls[i].trim(); if (t === "") { if (fim >= 0) break; continue; }
      var r = rotuloDe(ls[i]);
      if (!r || /^(Notas|Checklist|Descri[cç][aã]o)/i.test(r.rot) || ls[i].trim() === BLOCO_VALORES) break;
      fim = i;
    }
    return fim;
  }
  function setLinha(desc, key, texto) {
    var f = FIELDS[key], ls = linhas(desc), achou = -1;
    for (var i = 0; i < ls.length; i++) { var r = rotuloDe(ls[i]); if (r && f.re.test(r.rot)) { achou = i; break; } }
    if (!texto) { if (achou >= 0) ls.splice(achou, 1); return ls.join("\n"); }
    if (achou >= 0) { var r0 = rotuloDe(ls[achou]); ls[achou] = "**" + r0.rot + ":** " + texto; return ls.join("\n"); }
    var nova = "**" + f.line + ":** " + texto;
    if (!String(desc || "").trim()) return nova;
    var fim = fimDoCabecalho(ls);
    if (fim < 0) { ls.splice(0, 0, nova, ""); return ls.join("\n").replace(/\n\n\n+/g, "\n\n"); }
    ls.splice(fim + 1, 0, nova);
    return ls.join("\n");
  }
  function setDinheiro(desc, key, valor) {
    var ls = linhas(desc), f = FIELDS[key], re = new RegExp("^\\|\\s*\\**" + f.row + "\\b", "i");
    var bloco = linhasDoBloco(ls), alvo = -1;
    bloco.forEach(function (j) { if (re.test(ls[j].trim())) alvo = j; });
    var linha = valor == null ? null : "| " + f.row + " | " + fmtDinheiro(valor) + (f.suffix ? " / mês" : "") + " |";
    if (alvo >= 0) {
      if (linha) ls[alvo] = linha; else ls.splice(alvo, 1);
      var rest = linhasDoBloco(ls).filter(function (j) { return /R\$/.test(ls[j]); });
      if (!rest.length) { var i0 = idxValores(ls), b2 = linhasDoBloco(ls); ls.splice(i0, (b2.length ? b2[b2.length - 1] : i0) - i0 + 1); }
      return ls.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
    }
    if (!linha) return ls.join("\n");
    var i = idxValores(ls);
    if (i < 0) {
      var base = String(desc || "").replace(/\s+$/, "");
      return (base ? base + "\n\n" : "") + BLOCO_VALORES + "\n| Item | Valor |\n|---|---|\n" + linha;
    }
    var b = linhasDoBloco(ls), pos = b.length ? b[b.length - 1] + 1 : i + 1;
    if (!b.length) { ls.splice(i + 1, 0, "| Item | Valor |", "|---|---|", linha); }
    else ls.splice(pos, 0, linha);
    return ls.join("\n");
  }
  function normaliza(key, v) {
    var f = FIELDS[key];
    if (f.kind === "people") {
      var arr = Array.isArray(v) ? v : String(v || "").split(",");
      var vistos = {}, out = [];
      arr.map(function (x) { return umaLinha(x); }).filter(Boolean).forEach(function (x) { var k = semAcento(x).toLowerCase(); if (!vistos[k]) { vistos[k] = 1; out.push(x); } });
      return out;
    }
    if (f.kind === "money") { if (v == null || v === "") return null; var n = typeof v === "number" ? v : parseDinheiro(v); return isFinite(n) ? n : NaN; }
    if (f.kind === "date") { var s = umaLinha(v); var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + "-" + m[2] + "-" + m[1] : s; }
    if (f.kind === "longtext") return String(v == null ? "" : v).replace(/\s*\n+\s*/g, " ").trim();
    return umaLinha(v);
  }
  function set(desc, key, v) {
    var f = FIELDS[key]; v = normaliza(key, v);
    if (f.kind === "money") { if (typeof v === "number" && !isFinite(v)) throw new Error("valor inválido"); return setDinheiro(desc, key, v); }
    if (f.kind === "people") return setLinha(desc, key, v.join(", "));
    if (key === "prazo" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("data inválida");
    return setLinha(desc, key, v);
  }
  function igual(key, a, b) {
    var f = FIELDS[key];
    if (f.kind === "people") return normaliza(key, a).join("|").toLowerCase() === normaliza(key, b).join("|").toLowerCase();
    if (f.kind === "money") { var x = normaliza(key, a), y = normaliza(key, b); return (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.005); }
    return normaliza(key, a) === normaliza(key, b);
  }
  function editavel(desc, key) {
    var f = FIELDS[key]; if (!f) return { ok: false };
    if (f.kind === "money") { var d = dinheiro(desc, key); if (d.origem === "proposta") return { ok: false, motivo: "Vem da tabela da proposta na descrição (" + (d.linha || "") + "). Para mudar, edite a proposta no Kanzo." }; }
    return { ok: true };
  }

  /* ---------- validação suave: nunca bloqueia, só orienta. "erro" impede gravar lixo ---------- */
  function semAcento(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function validar(key, v, ctx) {
    ctx = ctx || {}; var f = FIELDS[key], out = [], n = normaliza(key, v), hoje = ctx.hoje || new Date().toISOString().slice(0, 10);
    if (f.kind === "money") {
      if (typeof n === "number" && !isFinite(n)) out.push({ nivel: "erro", msg: "Não entendi o valor. Use 69.033,32 ou 69 mil." });
      else if (n != null && n < 0) out.push({ nivel: "aviso", msg: "Valor negativo." });
      else if (n != null && key === "tcv" && ctx.mrc != null && n < ctx.mrc) out.push({ nivel: "aviso", msg: "TCV menor que o MRC de um mês. Confira." });
      else if (n != null) out.push({ nivel: "ok", msg: "Vai gravar " + fmtDinheiro(n) + (f.suffix ? " / mês" : "") });
    } else if (f.kind === "date") {
      if (n && !/^\d{4}-\d{2}-\d{2}$/.test(n)) out.push({ nivel: "erro", msg: "Data inválida. Use dd/mm/aaaa." });
      else if (n && n < hoje) out.push({ nivel: "aviso", msg: "Data no passado: o projeto entra em Prazo vencido." });
      else if (n && n > String(+hoje.slice(0, 4) + 3) + hoje.slice(4)) out.push({ nivel: "aviso", msg: "Mais de 3 anos à frente. Confira o ano." });
    } else if (f.kind === "people") {
      var time = (ctx.equipe || []).map(function (p) { return semAcento(p.nome).toLowerCase(); });
      n.forEach(function (p) { if (time.length && time.indexOf(semAcento(p).toLowerCase()) < 0) out.push({ nivel: "aviso", msg: "“" + p + "” não aparece em nenhum outro card. Confira a grafia." }); });
    } else {
      if (n && n.length < 3) out.push({ nivel: "aviso", msg: "Texto muito curto." });
      if (key === "solucao" && /^a definir$/i.test(n)) out.push({ nivel: "aviso", msg: "“A definir” mantém o projeto na força-tarefa." });
    }
    return out;
  }

  /* ---------- o que falta (mesmas regras dos indicadores) ---------- */
  function semSolucaoTxt(s) { return !s || /^a definir$/i.test(String(s).trim()); }
  function faltas(c) {
    var aberto = c.status !== "done", desc = c.description, out = [];
    if (semSolucaoTxt(get(desc, "solucao") || c.solution)) out.push("solucao");
    var tcv = get(desc, "tcv");
    if (tcv == null && ((aberto && !GANHO[c.stage] && c.stage !== "old-falhou") || GANHO[c.stage])) out.push("valor");
    if (aberto && !get(desc, "prazo")) out.push("prazo");
    if (!get(desc, "responsaveis").length) out.push("responsavel");
    return out;
  }
  /* Equipe real: nomes que aparecem em "Responsáveis" e "Criado por" dos cards. Nada inventado. */
  function equipe(cards) {
    var m = {};
    (cards || []).forEach(function (c) {
      get(c.description, "responsaveis").forEach(function (p) { var k = semAcento(p).toLowerCase(); (m[k] = m[k] || { nome: p, n: 0, criou: 0 }).n++; });
      linhas(c.description).forEach(function (l) { var r = rotuloDe(l); if (r && /^Criado por$/i.test(r.rot)) { var p = limpa(r.val), k = semAcento(p).toLowerCase(); if (p) (m[k] = m[k] || { nome: p, n: 0, criou: 0 }).criou++; } });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return (b.n - a.n) || a.nome.localeCompare(b.nome, "pt-BR"); });
  }
  /* Valores já usados em outros projetos (para autocompletar e "copiar de outro projeto") */
  function usados(cards, key, excetoId) {
    var m = {};
    (cards || []).forEach(function (c) {
      if (String(c.id) === String(excetoId)) return;
      var v = ler(c, key); if (FIELDS[key].kind === "people" || v == null || v === "") return;
      if (key === "solucao" && semSolucaoTxt(v)) return;
      var k = String(v); (m[k] = m[k] || { valor: v, cards: [] }).cards.push({ id: c.id, title: c.title });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.cards.length - a.cards.length; });
  }
  function buscar(lista, termo, campo) {
    var t = semAcento(termo).toLowerCase().trim(); if (!t) return lista.slice();
    return lista.map(function (x) {
      var s = semAcento(campo ? x[campo] : x).toLowerCase(), i = s.indexOf(t);
      var ini = s.split(/\s+/).some(function (w) { return w.indexOf(t) === 0; });
      return { x: x, sc: i < 0 ? -1 : (i === 0 ? 3 : ini ? 2 : 1) };
    }).filter(function (o) { return o.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; }).map(function (o) { return o.x; });
  }
  /* Valor do campo para um card: igual a get(), mas a solução também vem da tag solucao: do Kanzo. */
  function ler(card, key) {
    var v = get(card && card.description, key);
    if (key === "solucao" && !v && card && card.solution && !semSolucaoTxt(card.solution)) return card.solution;
    return v;
  }
  function texto(key, v) {
    var f = FIELDS[key];
    if (f.kind === "people") return (v || []).join(", ");
    if (f.kind === "money") return v == null ? "" : fmtDinheiro(v) + (f.suffix ? " / mês" : "");
    if (f.kind === "date") return v ? F.data(v) : "";
    return v || "";
  }

  g.KanzoFields = { FIELDS: FIELDS, ORDEM: ORDEM, QUALIDADE: QUALIDADE, BLOCO_VALORES: BLOCO_VALORES, get: get, set: set, prazo: prazo, dinheiro: dinheiro,
    normaliza: normaliza, igual: igual, ler: ler, editavel: editavel, validar: validar, faltas: faltas, equipe: equipe, usados: usados, buscar: buscar,
    parseDinheiro: parseDinheiro, fmtDinheiro: fmtDinheiro, texto: texto, semAcento: semAcento };
})(typeof window !== "undefined" ? window : globalThis);
