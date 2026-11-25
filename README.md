# Pré-vendas Kanzo

App de pré-vendas da Telekom DTGBS: Cloudflare Worker (`presales-kanzo`) + banco D1.

- URL: https://SEU-WORKER.SUA-CONTA.workers.dev
- **Aviso:** deploy só a partir do main mais recente; nunca publicar cópia antiga.
- Esta árvore é a versão publicada em 12/11/2026 (23be85cd): repaginação + API do OpenCode.

O front está em `public/`. O Worker entra por `main.js` / `worker.js` e o código fica em `src/`. O contrato da API está em `API.md`. Detalhes de login, sync e rotação de token: `LEIA-ME.md`.

## Publicar

Os segredos (`PEPPER`, `SYNC_TOKEN`, etc.) ficam só no Worker, com `wrangler secret`. Não grave `.env` nem `.dev.vars` no repositório. O `wrangler.toml` já aponta para o Worker e os D1 de produção.

```bash
npx wrangler@4 deploy --dry-run --outdir /tmp/presales-bundle
npx wrangler@4 deploy
```

Não publique sem o OK explícito.

## Testes

```bash
scripts/test.sh            # assets + node --test tests/*.mjs + delete_guard
scripts/test.sh --bundle   # idem + bundle do wrangler e API golden
```

## Versão pública
Cópia sem histórico do app, com dados fictícios. Os `database_id` do `wrangler.toml` são exemplos: crie seus bancos D1 e troque os ids. Os secrets (PEPPER, SYNC_TOKEN etc.) são definidos com `wrangler secret put` e não estão no repositório. Parte dos testes depende de dados reais que foram removidos e falha com o snapshot de exemplo.

## Como recriar (para usar como base, inclusive no Lovable)
**Login (completo no código):** `src/auth.js` (login por e-mail e senha, sessão em cookie HttpOnly, bloqueio após falhas, limite por IP, papéis admin/leitura), `src/http.js` (cookie), `src/pages.js` (tela de login e admin), `src/admin.js` (gestão de usuários) e `src/apikey.js` (chave de API por Bearer, só o hash no banco). Tabelas `presales_users` e `presales_sessoes` em `schema/presales.sql` e `src/migrations.js`.
- Precisa recriar: o D1 `DATA` (aplique `schema/presales.sql`; as migrações rodam ao abrir `/api/saude`), o secret `PEPPER` (hash das senhas) e, opcionalmente, o D1 `AUTH_DB`, um banco de login externo com a tabela `usuarios (email, senha, ativo)`. Sem ele, o login usa só `presales_users`.

**E-mail (completo no código):** `src/alertas.js` monta o relatório diário em HTML e envia por `env.EMAIL.send(...)`, no cron. O destinatário fica em `src/config.js` (`ADMIN_EMAIL`), e o remetente fica no meta `alert_email_from`.
- Precisa recriar: o binding `send_email` (Cloudflare Email Routing com domínio verificado) e o cron. Os exemplos estão comentados no `wrangler.toml`. Fora da Cloudflare, por exemplo no Lovable com Supabase, troque `env.EMAIL.send` por um provedor como Resend e o cron por uma função agendada.

**Lovable:** ele não roda Workers nem D1. Use o front (`public/`) e a lógica de `src/` como referência e refaça o backend em Supabase (tabelas a partir de `schema/presales.sql`, auth próprio ou Supabase Auth, e uma Edge Function para o e-mail).

**Agente do Mac (opcional):** `scripts/presales_sync_agent.py` e `install_mac_agent.sh` sincronizam com um app local; não é necessário para o app web.
