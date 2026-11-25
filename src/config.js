/* presales-kanzo · src/config.js — Constantes: limites de login/sessão, admin, ordem e rótulos das etapas. */
'use strict';

export var ITER = 100000, SESSAO_S = 30 * 86400, COOKIE = '__Host-mco';

export var JANELA_S = 900, MAX_FALHAS = 5, BLOQ_S = 900, MAX_IP = 20, MAC_ONLINE_S = 90, MAX_USERS = 4;

export var ADMIN_EMAIL = 'admin@exemplo.com';

export var STAGE_ORDER = ['hold','tarefas-internas-henrique','recebimento-do-projeto','processo-de-cotacao','precificacao','processo-aprovacao-precificacao','apresentacao-executiva','fechamento','ganho-handoff','projeto-longo-prazo','old-falhou'];

export var STAGE_LABEL = {
  'hold':'Hold','tarefas-internas-henrique':'Tarefas internas','recebimento-do-projeto':'Recebimento do projeto',
  'processo-de-cotacao':'Processo de cotação','precificacao':'Precificação','processo-aprovacao-precificacao':'Aprovação precificação',
  'apresentacao-executiva':'Apresentação executiva','fechamento':'Fechamento','ganho-handoff':'Ganho / Handoff',
  'projeto-longo-prazo':'Projeto longo prazo','old-falhou':'Old/Falhou'
};


/* 11/11/2026 (remodelo aprovado pelo Guilherme): o app é a fonte oficial e o Kanzo do Mac foi desligado.
   Sem a var MAC_SYNC = "1" no Worker, nada vai para a fila do Mac (pending_commands), as escritas gravam direto no D1
   e as rotas /sync/* respondem 410. Para religar o espelho do Mac (só em emergência): [vars] MAC_SYNC = "1" no wrangler.toml. */
export function macSyncLigado(env) { var v = env && env.MAC_SYNC; return v === '1' || v === 'true' || v === 1 || v === true; }
