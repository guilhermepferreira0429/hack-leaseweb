// node pitch/servir.mjs [porta]: serve esta pasta em http://127.0.0.1:8765 (só no próprio portátil).
// Não é preciso para apresentar (index.html abre com duplo clique); serve para testes com browser automático
// e para quando o browser bloquear alguma coisa em file://.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('.', import.meta.url));
const porta = Number(process.argv[2] ?? 8765);
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
  const ficheiro = join(raiz, caminho || 'index.html');
  if (!ficheiro.startsWith(raiz)) return void res.writeHead(403).end();
  try {
    const dados = await readFile(ficheiro);
    res.writeHead(200, { 'Content-Type': (tipos[extname(ficheiro)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' }).end(dados);
  } catch {
    res.writeHead(404).end('não existe');
  }
}).listen(porta, '127.0.0.1', () => console.log(`[pitch] http://127.0.0.1:${porta}/`));
