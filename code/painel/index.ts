// npm run dev:painel -> servidor HTTP na VM cérebro.
//   GET  /          linha do tempo: migrar -> atacar -> aprovar -> fechar (lida da auditoria)
//   ANY  /isco      página isco: qualquer visita gera um achado 'isco-tocado'
//   GET  /webhook   verificação do WhatsApp (hub.challenge)
//   POST /webhook   cliques nos botões (WhatsApp ou Telegram) -> defesa.tratarResposta
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tratarIsco } from './isco';
import { paginaLinhaTempo } from './linha-tempo';
import { tratarWebhook } from './webhook';

type Rota = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ROTAS: Record<string, Rota> = {
  '/': paginaLinhaTempo,
  '/isco': tratarIsco,
  '/webhook': tratarWebhook,
};

const PORTA = Number(process.env.PAINEL_PORTA ?? 8080);

const servidor = createServer((req, res) => {
  const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
  const rota = ROTAS[caminho];
  if (!rota) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    return;
  }
  rota(req, res).catch((erro: unknown) => {
    console.error('[painel]', caminho, erro instanceof Error ? erro.message : erro);
    if (!res.headersSent) res.writeHead(501, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Ainda não implementado');
  });
});

servidor.listen(PORTA, () => console.log(`[painel] http://localhost:${PORTA}`));
