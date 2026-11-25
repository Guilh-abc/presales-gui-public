/* presales-kanzo — Mac = fonte da verdade; allowlist própria; login lê a senha da Casa só se o e-mail estiver liberado.
   Ponto de entrada (main.js importa este arquivo). O código fica em src/:
     routes.js     roteador (API idêntica à versão monolítica b57507ef)
     auth.js       login, sessão, limite por IP, permissão de escrita, token de sync (SYNC_TOKEN / SYNC_TOKEN_NEXT)
     sync.js       /sync/* (push, snapshot, pull, ack), mapa de ids, status e falhas do Mac
     cards.js      cards, resumo, etapas, histórico e escrita online (fila para o Mac)
     admin.js      allowlist (máx. 4)
     migrations.js schema em migrations idempotentes
     db.js         D1, meta, auditoria e fila
     format.js     regras do card via public/js/kanzo-core.js (módulo único com o painel)
     http.js       respostas + cabeçalhos de segurança (CSP)
     pages.js      páginas de login/admin (JS/CSS em /portal/*)
     util.js, config.js */
export { default } from './src/routes.js';
