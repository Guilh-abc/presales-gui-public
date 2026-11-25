#!/usr/bin/env node
// Gera uma chave do OpenCode e o SQL para gravar SÓ o hash no D1 (migração 9 precisa estar aplicada: basta o Worker novo ter rodado uma vez).
// Uso: node scripts/opencode-chave.mjs [nome]   → imprime a chave (copiar UMA vez para o ~/.zshrc do Mac) e o INSERT.
// Revogar: UPDATE api_keys SET revogada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = <id>;
import crypto from 'node:crypto';
const nome = (process.argv[2] || 'OpenCode Mac').replace(/'/g, '').slice(0, 60);
const chave = 'kzo_' + crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(chave, 'utf8').digest('hex');
const agora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const sql = `INSERT INTO api_keys (nome, prefixo, hash, criada_em, criada_por) VALUES ('${nome}', '${chave.slice(0, 12)}', '${hash}', '${agora}', 'admin@exemplo.com');`;
if (process.argv.includes('--json')) console.log(JSON.stringify({ chave, sql }));
else console.log('CHAVE (mostrar uma vez, não salvar em lugar nenhum além do ~/.zshrc):\n' + chave + '\n\nSQL para o D1:\n' + sql);
