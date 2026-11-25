# Pré-vendas Kanzo (Cloudflare)

## URL publicada
https://SEU-WORKER.SUA-CONTA.workers.dev

## Arquitetura
- **Fonte de verdade:** D1 `presales-kanzo` (Worker `presales-kanzo`).
- **Espelho opcional + fila:** Kanzo no Mac (`~/kanzo`); o painel grava no D1 e enfileira para o Mac aplicar quando ligar.
- **Login:** mesmo da Casa em Ordem (D1 `minha-casa-acesso` + secret `PEPPER`). Sem Cloudflare Access/Zero Trust.
- **Sync automático (lote 3):** LaunchAgent `com.guilherme.presales-kanzo-sync` → `~/.config/presales-kanzo/presales_sync_agent.py` (intervalo ~8s), modo **pull-only**: baixa a fila e espelha no Kanzo; não faz push/snapshot.

## Segurança validada
- Sem login: `GET /` (Accept HTML) → **302** `/login`; `GET /api/*` → **401**.
- `/api/saude` público.
- `/sync/*` exige `X-Presales-Sync-Token` (**403** sem token).
- Login web: e-mail/senha da Casa em Ordem.

## Sync
- Token: `~/.config/presales-kanzo/sync-token` (chmod 600) + Keychain `presales-kanzo-sync-token`.
- Backup do DB antes de aplicar comandos da nuvem: `~/kanzo/backups/presales-sync/`.
- Conflito: **nuvem vence** no `/sync/push` (card com `cloud_writes`/pendente). Divergência em `sync_conflicts`. Creates online nunca são apagados pelo snapshot do Mac.
- Status no app: `GET /api/sync/status` (`mac_online`, `last_push_at`, `pending_commands`).

## Rodar sync manual
```bash
/usr/bin/python3 ~/.config/presales-kanzo/presales_sync_agent.py once
tail -f ~/.config/presales-kanzo/sync.log
```

## API
Ver `API.md`.

## Home publicada
A home (`/`) é o dashboard completo de pré-vendas (`public/index.html` + `js/data-source.js` + `js/app.js`), lendo a API ao vivo (`/api/cards`, `/api/summary`, `/api/stages`, `/api/sync/status`, `/api/me`). CRUD ativo só para o admin; viewers recebem 403 em toda escrita. Allowlist própria em D1 `presales-kanzo` (`presales_users`, máx. 4); login reutiliza a senha da Casa em Ordem **somente** se o e-mail estiver na allowlist — não concede acesso automático aos usuários da Casa e não altera o D1 `minha-casa-acesso`. Indicador no app usa `last_pull_at` (Mac online/offline), fila pendente e último snapshot histórico. O agente atual não envia mais snapshot.

## Rotação do token de sync (sem downtime)
O Worker aceita **dois** tokens ao mesmo tempo: o secret `SYNC_TOKEN` (atual) e, só durante a troca, o secret `SYNC_TOKEN_NEXT` (próximo). A comparação é em tempo constante e nenhum dos dois aparece em resposta ou log. `GET /api/sync/status` mostra `sync_token.slot_em_uso` (`atual` ou `proximo`, a vaga que o Mac usou por último) e `sync_token.rotacao_em_andamento` (`true` enquanto `SYNC_TOKEN_NEXT` existir). O agente do Mac relê `~/.config/presales-kanzo/sync-token` a cada chamada, então trocar o arquivo basta (sem reiniciar o LaunchAgent).

Procedimento (nunca imprimir o token; `chmod 600` em todo arquivo com token):
1. Gerar o novo valor num arquivo: `umask 077; openssl rand -base64 48 | tr -d '\n' > /tmp/sync-token.next`.
2. Publicar como próximo: `CLOUDFLARE_API_TOKEN="$CF_WORKERS_EDIT_TOKEN" npx wrangler@4 secret put SYNC_TOKEN_NEXT < /tmp/sync-token.next`. A partir daqui os dois valem.
3. No Mac: backup do token atual (`cp -p ~/.config/presales-kanzo/sync-token ~/.config/presales-kanzo/sync-token.bak-AAAAMMDD`), copiar o novo para `~/.config/presales-kanzo/sync-token` (modo 600) e atualizar o item `presales-kanzo-sync-token` no Keychain.
4. Conferir no painel/`/api/sync/status`: `slot_em_uso = "proximo"` e Mac online. Se algo falhar, voltar o arquivo `.bak` (o token antigo ainda vale).
5. Promover: `secret put SYNC_TOKEN < /tmp/sync-token.next` e depois `npx wrangler@4 secret delete SYNC_TOKEN_NEXT`. O status volta a `slot_em_uso = "atual"`, `rotacao_em_andamento = false`, e o token antigo deixa de valer.
6. Apagar `/tmp/sync-token.next` e o `.bak` do Mac depois de 1 dia sem problema.

Sugestão: trocar a cada 90 dias ou na hora, se houver suspeita de vazamento.

## Testes (comando único)
```bash
scripts/test.sh            # assets + node --test tests/*.mjs + delete_guard (Python)
scripts/test.sh --bundle   # idem + bundle do wrangler (dry-run) e API golden contra o bundle
```
- `tests/helpers/servidor-local.mjs`: sobe o Worker local (D1 simulado, sem produção) para abrir o painel no navegador.
- Os testes de integração com `wrangler dev` (`tests/worker.integ.test.mjs`) só rodam com `KV3_API` definido.

## Código do Worker
`worker.js` é só a entrada; o código está em `src/` (routes, auth, sync, cards, admin, migrations, db, format, http, pages, util, config). Regras de leitura do card (atraso, valores, tags) ficam **só** em `public/js/kanzo-core.js`, usado pelo Worker e pelo painel. Schema: migrations idempotentes em `src/migrations.js` (versão em `meta.schema_version`); para mudar, adicionar uma migration nova no fim.

## CSP
Sem `'unsafe-inline'`: nada de `<script>`/`<style>` inline, atributo `style=` ou `onclick=`. Use classes (utilitários `u-*` em `styles.css`) e, para valores dinâmicos, `data-bg`/`data-sx` (aplicados por `js/estilos-dinamicos.js`). O `tests/csp.test.mjs` barra regressões.
