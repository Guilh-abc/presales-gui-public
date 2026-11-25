# Presales Cloudflare API (Kanzo)

Contrato esperado pelo dashboard. Mesma origem, `credentials: 'include'` (Cloudflare Access).

## Leitura

| Método | Path | Resposta |
|--------|------|----------|
| GET | `/api/health` | `{ ok: true, version, source: "d1" }` |
| GET | `/api/summary` | totais opcionais (dashboard recalcula no cliente) |
| GET | `/api/stages` | `[{ key, label, order }]` |
| GET | `/api/cards` | `{ cards: Card[], meta?: { updated_at } }` |
| GET | `/api/cards/:id` | `Card` |

`Card` (campos usados pelo front):
```json
{
  "id": 47,
  "key": "optional",
  "title": "string",
  "status": "todo|doing|done|backlog|review",
  "stage": "apresentacao-executiva|ganho-handoff|...",
  "priority": "media|importante|baixa|null",
  "labels": ["guilherme"],
  "atrasado": false,
  "solution": "Starlink / Satélite|A definir|...",
  "description": "markdown público",
  "comments": [{ "id": "c1", "body": "...", "created_at": "ISO" }],
  "values": { "tcv": 0, "mrc": 0, "otc": 0, "prazo_meses": 12, "valor_estimado": null, "quantidades": [] },
  "planner": {},
  "created_at": "ISO",
  "updated_at": "ISO",
  "active": true,
  "deleted_at": null
}
```

## Escrita (CRUD)

| Método | Path | Body | Efeito |
|--------|------|------|--------|
| POST | `/api/cards` | `{ title, status?, stage?, priority?, labels?, description?, solution?, values? }` | cria |
| PATCH | `/api/cards/:id` | campos parciais | edita |
| POST | `/api/cards/:id/move` | `{ stage?, status? }` | move etapa/status |
| POST | `/api/cards/:id/deactivate` | `{}` | desativa (`active=false`) |
| DELETE | `/api/cards/:id` | — | soft-delete (`deleted_at`) |
| POST | `/api/cards/:id/restore` | `{}` | restaura da lixeira |
| POST | `/api/cards/:id/comments` | `{ body }` | novo comentário |
| PATCH | `/api/cards/:id/comments/:cid` | `{ body }` | edita comentário |
| DELETE | `/api/cards/:id/comments/:cid` | — | remove comentário |
| POST | `/api/products` | `{ card_id, name, qty?, unit? }` | produto no card |
| PATCH | `/api/products/:id` | parcial | edita produto |
| DELETE | `/api/products/:id` | — | remove produto |
| POST | `/api/solutions` | `{ card_id, label }` | associa solução |
| PATCH | `/api/solutions/:id` | parcial | edita |
| DELETE | `/api/solutions/:id` | — | remove |
| POST | `/api/tasks` | `{ card_id, title, done? }` | subtarefa |
| PATCH | `/api/tasks/:id` | parcial | edita/conclui |
| DELETE | `/api/tasks/:id` | — | remove |

Erros: `{ error: string, code?: string }` com HTTP 4xx/5xx.
Auth: Cloudflare Access cookie/JWT na mesma origem.

## Snapshot

Se a API falhar, o front carrega `js/dados-kanzo.js` (`window.KANZO_SNAPSHOT`) e **desabilita escrita**.
