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
