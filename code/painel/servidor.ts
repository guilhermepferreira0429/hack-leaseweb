// Painel HTTP no cérebro (porta do painel aberta só ao nosso IP).
//   GET /             linha do tempo: migrar -> atacar -> aprovar -> fechar, com botão Desfazer
//   GET /isco         contador de tentativas de entrada na VM isco (abertura do pitch)
//   GET /estado.json  pedidos (shared/estado) + auditoria, para a página se atualizar sozinha
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { paginaIsco } from './isco';
import { paginaLinhaTempo, estadoJson } from './linha-tempo';

type Rota = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ROTAS: Record<string, Rota> = {
  '/': paginaLinhaTempo,
  '/isco': paginaIsco,
  '/estado.json': estadoJson,
};

export function iniciarPainel(porta: number): Server {
  const servidor = createServer((req, res) => {
    const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
    const rota = req.method === 'GET' ? ROTAS[caminho] : undefined;
    if (!rota) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    rota(req, res).catch((erro: unknown) => {
      console.error('[painel]', caminho, erro instanceof Error ? erro.message : erro);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro');
    });
  });
  servidor.listen(porta, () => console.log(`[painel] http://localhost:${porta}`));
  return servidor;
}
