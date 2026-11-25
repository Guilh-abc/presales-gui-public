// Gera assets.js (mapa caminho -> {t: content-type, g: gzip base64}) a partir de public/.
// Uso: node scripts/gerar-assets.mjs [--check]
// --check: só confere se o assets.js atual bate com public/ (sai com código 1 se não bater).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'assets.js');
// Fora do bundle, como no assets.js original: cópia standalone e relatório interno.
const EXCLUIR = new Set(['/Kanzo-dashboard.standalone.html',
  // Lote 0 (09/11): prévias PNG e o JSON antigo não são usados pelo painel (75 % do assets.js) e o JSON tinha descrições completas.
  '/previews/desktop-1280.png', '/previews/mobile-390.png', '/data/dashboard-data.json']); // RELATORIO-GAPS.json entra (atrás do login), pedido do Chefe Geral 09/11
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

function listar(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base + '/' + e.name;
    if (e.isDirectory()) return listar(path.join(dir, e.name), rel);
    return EXCLUIR.has(rel) || e.name.startsWith('.') ? [] : [rel];
  }).sort();
}
const arquivos = listar(PUB);

if (process.argv.includes('--check')) {
  const atual = (await import(pathToFileURL(OUT).href + '?t=' + Date.now())).default;
  let ruins = [];
  for (const p of new Set([...arquivos, ...Object.keys(atual)])) {
    const disco = arquivos.includes(p) ? fs.readFileSync(path.join(PUB, p)) : null;
    const emb = atual[p] ? zlib.gunzipSync(Buffer.from(atual[p].g, 'base64')) : null;
    if (!disco || !emb || !disco.equals(emb)) ruins.push(p);
  }
  if (ruins.length) { console.error('Diferente de public/:', ruins.join(', ')); process.exit(1); }
  console.log('assets.js confere com public/ (' + arquivos.length + ' arquivos)');
} else {
  const mapa = {};
  for (const p of arquivos) {
    const tipo = TIPOS[path.extname(p).toLowerCase()];
    if (!tipo) throw new Error('Tipo desconhecido: ' + p);
    mapa[p] = { t: tipo, g: zlib.gzipSync(fs.readFileSync(path.join(PUB, p)), { level: 9 }).toString('base64') };
  }
  fs.writeFileSync(OUT, 'export default ' + JSON.stringify(mapa) + ';\n');
  console.log('assets.js gerado: ' + arquivos.length + ' arquivos, ' + fs.statSync(OUT).size + ' bytes');
}
