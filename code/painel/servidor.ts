// Painel HTTP no cérebro. Por omissão escuta só em 127.0.0.1 (ver por túnel: ssh -L 3000:localhost:3000 ...).
// Abrir de fora só de propósito: PAINEL_HOST=0.0.0.0 com o security group fechado ao nosso IP.
//   GET  /             linha do tempo: migrar -> atacar -> aprovar -> fechar, relógio de exposição, botão Desfazer
//   GET  /isco         contador de tentativas de entrada na VM isco (abertura do pitch); ?json para números
//   GET  /palco        o ecrã para o júri (inglês, uma tela, números grandes)
//   GET  /certificado  certificado de migração (ecrã e impressão)
//   GET  /estado.json  pedidos (shared/estado) + auditoria, para a página se atualizar sozinha
//   POST /desfazer     id + token (PAINEL_TOKEN). Sem PAINEL_TOKEN no .env, o botão não existe e a rota recusa.
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { carregarEnv } from '@mwbe/shared';
import { paginaCertificado } from './certificado';
import { paginaIsco } from './isco';
import { paginaPalco } from './palco';
import { paginaLinhaTempo, estadoJson } from './linha-tempo';

type Rota = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface OpcoesPainel {
  /** Aplica o inverso de um pedido. Por omissão, defesa.desfazer. */
  desfazer?: (pedidoId: string) => Promise<void>;
  host?: string;
}

const ROTAS: Record<string, Rota> = {
  '/': paginaLinhaTempo,
  '/isco': paginaIsco,
  '/estado.json': estadoJson,
  '/certificado': paginaCertificado,
  '/palco': paginaPalco,
};

const texto = (res: ServerResponse, estado: number, msg: string) =>
  res.writeHead(estado, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg);

function lerCorpo(req: IncomingMessage, limite = 4096): Promise<string> {
  return new Promise((ok, falha) => {
    let corpo = '';
    req.on('data', (c: Buffer) => {
      corpo += c.toString('utf8');
      if (corpo.length > limite) {
        req.destroy();
        falha(new Error('corpo demasiado grande'));
      }
    });
    req.on('end', () => ok(corpo));
    req.on('error', falha);
  });
}

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** POST /desfazer: token certo e pedido vindo da própria página (Origin igual ao Host), nunca por GET. */
export async function tratarDesfazer(req: IncomingMessage, res: ServerResponse, desfazer: (id: string) => Promise<void>): Promise<void> {
  const token = process.env.PAINEL_TOKEN ?? '';
  if (!token) return void texto(res, 403, 'Desfazer pelo painel desligado (PAINEL_TOKEN vazio). Use /desfazer <id> no Telegram.');
  const origem = req.headers.origin;
  if (origem && new URL(origem).host !== req.headers.host) return void texto(res, 403, 'Origem recusada');
  const campos = new URLSearchParams(await lerCorpo(req));
  if (!iguais(campos.get('token') ?? '', token)) return void texto(res, 403, 'Token errado');
  const id = campos.get('id') ?? '';
  if (!/^[\w-]{1,64}$/.test(id)) return void texto(res, 400, 'Id inválido');
  await desfazer(id);
  res.writeHead(303, { Location: '/' }).end();
}

export function iniciarPainel(porta: number, opcoes: OpcoesPainel = {}): Server {
  carregarEnv();
  const desfazer = opcoes.desfazer ?? (async (id: string) => (await import('@mwbe/defesa')).desfazer(id));
  const servidor = createServer((req, res) => {
    const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
    const rota: Rota | undefined =
      req.method === 'GET' ? ROTAS[caminho] : req.method === 'POST' && caminho === '/desfazer' ? (q, r) => tratarDesfazer(q, r, desfazer) : undefined;
    if (!rota) return void texto(res, 404, 'Não encontrado');
    rota(req, res).catch((erro: unknown) => {
      console.error('[painel]', caminho, erro instanceof Error ? erro.message : erro);
      if (!res.headersSent) texto(res, 500, `Erro: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
      else res.end();
    });
  });
  // || e não ??: um PAINEL_HOST= vazio no .env abria o painel em todas as interfaces.
  const host = opcoes.host || process.env.PAINEL_HOST?.trim() || '127.0.0.1';
  servidor.listen(porta, host, () => console.log(`[painel] http://${host}:${porta}`));
  return servidor;
}
