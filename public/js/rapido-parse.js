/* rapido-parse.js — Registro rápido pelo celular: parser determinístico (sem LLM, sem rede, sem DOM).
   Carregado como <script> em /rapido.html e testado em node (vm). Só PROPÕE; nada é enfileirado aqui.
   Regras de segurança:
   - Etapa só muda com frase explícita ("mandei proposta", "em cotação"...). Só "proposta" solta = comentário.
   - Ganho/perda = fechamento: sempre pede confirmação extra (UI + servidor) e é bloqueado por negação/dúvida.
   - Status do card NÃO é alterado (nos dados reais "Ganho / Handoff" tem cards todo/doing/done).
   - Saúde e prazo vão na descrição, nos mesmos campos do editor ("**Saúde:**", "**Prazo (Kanzo):**").
   - Datas relativas ("sexta", "amanhã") resolvidas no fuso America/Sao_Paulo e mostradas por extenso. */
(function (g) {
  "use strict";
  var TZ = "America/Sao_Paulo";
  var STAGE_LABEL = {
    "hold": "Hold", "tarefas-internas-henrique": "Tarefas internas", "recebimento-do-projeto": "Recebimento do projeto",
    "processo-de-cotacao": "Processo de cotação", "precificacao": "Precificação", "processo-aprovacao-precificacao": "Aprovação precificação",
    "apresentacao-executiva": "Apresentação executiva", "fechamento": "Fechamento", "ganho-handoff": "Ganho / Handoff",
    "projeto-longo-prazo": "Projeto longo prazo", "old-falhou": "Old/Falhou"
  };
  var FECHAMENTO = { "ganho-handoff": 1, "old-falhou": 1 };

  function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function palavras(s) { return norm(s).split(/[^a-z0-9]+/).filter(Boolean); }

  /* Frases de etapa (texto já sem acento). A ordem importa: fechamento por último para não engolir "aguardando assinatura". */
  var ETAPAS = [
    { stage: "apresentacao-executiva", re: /\b(mandei|enviei|enviamos|mandamos|apresentei|apresentamos|fiz|entreguei)\s+(a\s+|o\s+)?(proposta|apresentacao)\b|\bproposta\s+(enviada|entregue|apresentada)\b/ },
    { stage: "processo-de-cotacao", re: /\b(em\s+cotacao|pedi\s+(a\s+)?cotacao|cotando|solicitei\s+(a\s+)?cotacao)\b/ },
    { stage: "processo-aprovacao-precificacao", re: /\b(em\s+aprovacao|(mandei|enviei)\s+(para|pra|p\/)\s+aprovacao|aguardando\s+aprovacao(\s+(do|de)\s+(pricing|precificacao))?)\b/ },
    { stage: "precificacao", re: /\b(em\s+(pricing|precificacao)|precificando|fazendo\s+(o\s+)?(pricing|precificacao))\b/ },
    { stage: "fechamento", re: /\b(em\s+fechamento|negociando\s+(o\s+)?fechamento)\b/ },
    { stage: "hold", re: /\b(em\s+hold|em\s+espera|pausad[oa])\b/ },
    { stage: "ganho-handoff", re: /\b(ganh(o|amos|ei)|fechamos|fechad[oa]\s+(com|o\s+contrato)|contrato\s+assinado|assinad[oa]|assinou|assinaram)\b/ },
    { stage: "old-falhou", re: /\b(perd(a|emos|i|ido|ida)|falhou|declin(ou|aram|ado)|cliente\s+desistiu)\b/ }
  ];
  var NEGACAO = /\b(nao|nem|ainda\s+nao|sera\s+que|talvez|se\s+(ganhar|perder|fechar))\b|\?/;

  var SAUDE = [
    { valor: "", re: /\b(limpar|tirar|remover)\s+(a\s+)?(saude|health)\b/ },
    { valor: "No prazo", re: /\b(saude\s+ok|ok\s+saude|no\s+prazo)\b/ },
    { valor: "Bloqueado", re: /\bbloquead[oa]\b/ },
    { valor: "Em risco", re: /\b(em\s+risco|risco)\b/ },
    { valor: "Atenção", re: /\b(atencao)\b/ },
    { valor: "Aguardando externo", re: /\b(aguardando|esperando)\s+(o\s+|a\s+)?(cliente|assinatura|retorno|fornecedor|resposta|documentos?|po|pedido)\b/ }
  ];

  var DIAS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  var NOME_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  function hojeISO(agora) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(agora != null ? agora : Date.now())); }
  function somaDias(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diaSemana(iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); }
  function valida(y, m, d) { var dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function porExtenso(iso) { var p = iso.split("-"); return NOME_DIA[diaSemana(iso)] + ", " + p[2] + "/" + p[1] + "/" + p[0]; }

  /* "prazo <data>": hoje, amanhã, depois de amanhã, <dia da semana>[-feira] [que vem], dd/mm, dd/mm/aaaa, dia dd.
     Dia da semana = a próxima ocorrência a partir de amanhã ("sexta" dita numa sexta = a da semana seguinte).
     dd/mm sem ano já passado = avisa e usa o ano seguinte. Devolve { iso, aviso } ou { erro }. */
  function resolverPrazo(txt, agora) {
    var t = norm(txt).trim(), hoje = hojeISO(agora), m;
    if (/^hoje\b/.test(t)) return { iso: hoje };
    if (/^depois\s+de\s+amanha\b/.test(t)) return { iso: somaDias(hoje, 2) };
    if (/^amanha\b/.test(t)) return { iso: somaDias(hoje, 1) };
    m = t.match(/^(?:(?:na|no|ate|para|pra)\s+)?(?:proxim[oa]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira|\s+feira)?(\s+que\s+vem)?\b/);
    if (m) {
      var alvo = DIAS[m[1]], dif = (alvo - diaSemana(hoje) + 7) % 7; if (dif === 0) dif = 7;
      if (m[2]) dif += 7;
      return { iso: somaDias(hoje, dif) };
    }
    m = t.match(/^(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/);
    if (m) {
      var d = +m[1], mes = +m[2], ano = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +hoje.slice(0, 4);
      if (!valida(ano, mes, d)) return { erro: "Data inválida: " + m[0] };
      var iso = ano + "-" + pad(mes) + "-" + pad(d), aviso = null;
      if (!m[3] && iso < hoje) { iso = (ano + 1) + iso.slice(4); aviso = "Sem ano e já passou este ano: usei " + (ano + 1) + "."; }
      return { iso: iso, aviso: aviso };
    }
    m = t.match(/^(?:ate\s+)?(?:o\s+)?dia\s+(\d{1,2})\b/);
    if (m) {
      var y = +hoje.slice(0, 4), mm = +hoje.slice(5, 7), dd = +m[1];
      if (dd < +hoje.slice(8, 10)) { mm++; if (mm > 12) { mm = 1; y++; } }
      if (!valida(y, mm, dd)) return { erro: "Data inválida: dia " + dd };
      return { iso: y + "-" + pad(mm) + "-" + pad(dd) };
    }
    return { erro: "Não entendi a data do prazo. Use, por exemplo: prazo sexta, prazo 15/11 ou prazo 15/11/2026." };
  }

  /* Palavras que não identificam card (verbos, conectivos, termos de ação). */
  var PARADAS = {};
  ("a o as os e de da do das dos em no na nos nas um uma para pra pro com sem por que se ja hoje amanha ontem " +
   "mandei enviei enviamos mandamos fiz apresentei apresentamos entreguei proposta enviada entregue apresentacao cotacao cotando pedi solicitei " +
   "pricing precificacao precificando fazendo aprovacao fechamento negociando hold espera pausado pausada ganho ganhamos ganhei fechamos fechado fechada " +
   "contrato assinado assinada assinou assinaram assinatura perda perdemos perdi perdido perdida falhou declinou declinaram declinado cliente desistiu " +
   "aguardando esperando retorno fornecedor resposta documento documentos pedido saude health ok limpar tirar remover risco atencao bloqueado bloqueada " +
   "prazo dia ate proximo proxima segunda terca quarta quinta sexta sabado domingo feira vem depois comentario nota card nao nem talvez sera ainda " +
   "vou vai foi tem ter esta estou estamos pediu pedimos revisao revisar mrc tcv otc").split(" ").forEach(function (w) { PARADAS[w] = 1; });

  /* Identifica o card: palavras do trecho de referência (antes da 1ª vírgula, ou o texto todo) que aparecem
     como palavra inteira no título. Peso = 1/(nº de títulos com a palavra): "Cliente Delta" (3 cards) pesa mais que "Starlink". */
  function candidatos(ref, cards) {
    var ws = palavras(ref).filter(function (w) { return !PARADAS[w] && (w.length >= 3 || /^\d+$/.test(w)); });
    if (!ws.length) return [];
    var tit = cards.map(function (c) { var set = {}; palavras(c.title).forEach(function (w) { set[w] = 1; }); return set; });
    var df = {}; ws.forEach(function (w) { df[w] = tit.filter(function (s) { return s[w]; }).length; });
    var out = [];
    cards.forEach(function (c, i) {
      var sc = 0, hit = [];
      ws.forEach(function (w) { if (tit[i][w]) { sc += 1 / df[w]; hit.push(w); } });
      if (sc > 0) out.push({ id: c.id, title: c.title, stage: c.stage || null, stage_label: STAGE_LABEL[c.stage] || c.stage || "", status: c.status || null, score: Math.round(sc * 1000) / 1000, palavras: hit });
    });
    out.sort(function (a, b) { return b.score - a.score || String(a.title).localeCompare(String(b.title)); });
    return out;
  }

  /* interpretar(texto, cards, opts) → proposta para a tela de confirmação.
     cards: [{id, title, stage, status}] (do /api/cards). opts.agora: ms (testes). opts.card_id: escolha do usuário entre candidatos. */
  function interpretar(texto, cards, opts) {
    opts = opts || {}; cards = (cards || []).filter(function (c) { return c && c.id != null && c.title; });
    var raw = String(texto == null ? "" : texto).trim();
    var res = { ok: false, raw: raw, card_id: null, candidatos: [], ambiguous: false, mudancas: { stage: null, saude: null, prazo: null }, comentario: raw, fechamento: false, resumo: [], avisos: [] };
    if (!raw) { res.avisos.push("Digite o que aconteceu, por exemplo: Cliente Delta, mandei proposta."); return res; }
    if (raw.length > 2000) { res.avisos.push("Texto longo demais (máx. 2.000 caracteres)."); return res; }
    var n = norm(raw);
    var mNota = n.match(/\b(comentario|nota)\s*:/), so = !!mNota;
    var ref = so ? raw.slice(0, mNota.index) : (raw.indexOf(",") > 0 ? raw.slice(0, raw.indexOf(",")) : raw);
    if (so) res.comentario = raw.slice(mNota.index + mNota[0].length).trim() || raw;

    var cand = candidatos(ref, cards);
    if (!cand.length && ref !== raw) cand = candidatos(raw, cards);
    res.candidatos = cand.slice(0, 8);
    if (opts.card_id != null) {
      var esc = cards.filter(function (c) { return String(c.id) === String(opts.card_id); })[0];
      if (!esc) { res.avisos.push("Card escolhido não existe mais no espelho."); return res; }
      res.card_id = esc.id; res.card_title = esc.title; res.card_stage = esc.stage || null;
    } else if (!cand.length) {
      res.avisos.push("Não encontrei nenhum card com esse nome. Comece pelo cliente, por exemplo: Cliente Delta, mandei proposta.");
      return res;
    } else {
      var topo = cand.filter(function (c) { return c.score === cand[0].score; });
      if (topo.length > 1) { res.ambiguous = true; res.candidatos = topo.slice(0, 8); res.avisos.push("Mais de um card combina. Toque no card certo."); }
      else { res.card_id = cand[0].id; res.card_title = cand[0].title; res.card_stage = cand[0].stage; }
    }

    if (!so) {
      var neg = NEGACAO.test(n);
      for (var i = 0; i < ETAPAS.length; i++) {
        if (!ETAPAS[i].re.test(n)) continue;
        var st = ETAPAS[i].stage;
        if (FECHAMENTO[st] && neg) { res.avisos.push("Frase com negação ou dúvida: não vou marcar como " + STAGE_LABEL[st] + ". Fica só o comentário."); break; }
        res.mudancas.stage = st; res.fechamento = !!FECHAMENTO[st]; break;
      }
      for (var j = 0; j < SAUDE.length; j++) if (SAUDE[j].re.test(n)) { res.mudancas.saude = SAUDE[j].valor; break; }
      var mp = n.match(/\bprazo\s+(?:e\s+|eh\s+|para\s+|pra\s+|ate\s+)?(.+)$/);
      if (mp) {
        var pz = resolverPrazo(mp[1], opts.agora);
        if (pz.erro) res.avisos.push(pz.erro); else { res.mudancas.prazo = pz.iso; if (pz.aviso) res.avisos.push(pz.aviso); }
      }
    }
    if (res.card_stage && res.mudancas.stage === res.card_stage) { res.avisos.push("O card já está em " + STAGE_LABEL[res.card_stage] + "."); res.mudancas.stage = null; res.fechamento = false; }

    if (res.mudancas.stage && FECHAMENTO[res.card_stage]) {
      res.fechamento = true;
      res.avisos.push("O card está em " + STAGE_LABEL[res.card_stage] + ". Mudar a etapa reabre o card.");
    }

    var m = res.mudancas;
    if (m.stage) res.resumo.push("Etapa: " + (STAGE_LABEL[res.card_stage] || res.card_stage || "?") + " → " + STAGE_LABEL[m.stage]);
    if (m.saude != null) res.resumo.push(m.saude ? "Saúde: " + m.saude : "Saúde: limpar");
    if (m.prazo) res.resumo.push("Prazo (Kanzo): " + porExtenso(m.prazo));
    res.resumo.push("Comentário: " + res.comentario);
    if (res.fechamento) res.avisos.push("Mudança de fechamento (" + STAGE_LABEL[m.stage] + "). Confirme marcando a caixa.");
    res.ok = !res.ambiguous;
    return res;
  }

  g.KanzoRapido = { interpretar: interpretar, resolverPrazo: resolverPrazo, candidatos: candidatos, hojeISO: hojeISO, porExtenso: porExtenso, STAGE_LABEL: STAGE_LABEL, FECHAMENTO: FECHAMENTO, TZ: TZ };
})(typeof window !== "undefined" ? window : globalThis);
