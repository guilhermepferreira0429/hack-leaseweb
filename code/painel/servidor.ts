// Painel HTTP no cérebro. Por omissão escuta só em 127.0.0.1 (ver por túnel: ssh -L 3000:localhost:3000 ...).
// Abrir de fora só de propósito: PAINEL_HOST=0.0.0.0 com o security group fechado ao nosso IP.
//   GET  /             ecrã da demo v2 (inglês): cadeia dos agentes, serviços, logs ao vivo, relógio, Undo e Download
//   GET  /v1           o ecrã anterior (linha do tempo), mantido como recurso
//   GET  /relatorio.pdf   o relatório A4 do ciclo (certificado + incidentes) em PDF, para descarregar
//   GET  /isco         contador de tentativas de entrada na VM isco (abertura do pitch); ?json para números
//   GET  /palco        o ecrã para o júri (inglês, uma tela, números grandes)
//   GET  /certificado  certificado de migração (ecrã e impressão)
//   GET  /estado.json  pedidos (shared/estado) + auditoria, para a página se atualizar sozinha. Vista pública
//                      (pedido de fora da máquina): só uma versão (hash) e a contagem, sem IPs nem ids de SG.
//   POST /desfazer     id + token (PAINEL_TOKEN). Sem PAINEL_TOKEN no .env, o botão não existe e a rota recusa.
//   POST /iniciar      token. Arranca uma corrida (npm run demo -- --sem-painel), uma de cada vez.
//   POST /limpar       token. Para a corrida, arquiva a auditoria do ciclo, repõe o repo da app e reabre de
//                      propósito a 5432 da vítima (npm run lsw:vitima -- reabrir). Fica tudo na auditoria.
// Os botões e o token só aparecem na vista local (127.0.0.1, ou por túnel SSH): de fora a página é só para ver.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, openSync, renameSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { auditoria, carregarEnv, estado, RAIZ_REPO } from '@mwbe/shared';
import { paginaCertificado } from './certificado';
import { paginaIsco } from './isco';
import { paginaPalco } from './palco';
import { estadoJson } from './linha-tempo';
import { paginaRelatorio, paginaV2, pedidoLocal } from './v2';

type Rota = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface OpcoesPainel {
  /** Aplica o inverso de um pedido. Por omissão, defesa.desfazer. */
  desfazer?: (pedidoId: string) => Promise<void>;
  host?: string;
}

const ROTAS: Record<string, Rota> = {
  '/': (req, res) => paginaV2(req, res, { aCorrer: tarefa?.tipo }),
  '/relatorio.pdf': paginaRelatorio,
  '/isco': paginaIsco,
  '/estado.json': estadoJsonSeguro,
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

/** /estado.json completo só na vista local; de fora, só o suficiente para o auto-refresh (muda quando muda). */
export async function estadoJsonSeguro(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (pedidoLocal(req)) return estadoJson(req, res);
  const eventos = auditoria.ler();
  const versao = createHash('sha256').update(JSON.stringify([estado.listarPedidos(), eventos])).digest('hex').slice(0, 16);
  res
    .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ versao, eventos: eventos.length, aCorrer: tarefa?.tipo ?? null }));
}

// ---- Start / Reset: uma tarefa de cada vez (single-flight). Comandos fixos; o pedido só traz o token.

type Tarefa = { tipo: 'demo' | 'reset'; processo: ChildProcess; fim: Promise<void> };
let tarefa: Tarefa | undefined;

/** Tarefa a decorrer (para testes e para o ecrã). */
export function tarefaAtual(): 'demo' | 'reset' | undefined {
  return tarefa?.tipo;
}

/** Mesmas guardas do Desfazer: PAINEL_TOKEN definido, Origin igual ao Host e token certo. Se falhar, responde e devolve false. */
async function autorizar(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const token = process.env.PAINEL_TOKEN ?? '';
  if (!token) {
    texto(res, 403, 'Panel actions are disabled (PAINEL_TOKEN is empty).');
    return false;
  }
  const origem = req.headers.origin;
  if (origem && new URL(origem).host !== req.headers.host) {
    texto(res, 403, 'Origin rejected');
    return false;
  }
  const campos = new URLSearchParams(await lerCorpo(req));
  if (!iguais(campos.get('token') ?? '', token)) {
    texto(res, 403, 'Wrong token');
    return false;
  }
  return true;
}

/** Corre um comando fixo noutro processo (logs em tmpdir/painel-<tipo>.log). Nada vem do pedido HTTP. */
function lancar(tipo: Tarefa['tipo'], comando: string, aoTerminar: (codigo: number | null) => void): Tarefa {
  const log = openSync(join(tmpdir(), `painel-${tipo}.log`), 'a');
  const windows = process.platform === 'win32';
  const processo = spawn('bash', ['-c', comando], {
    cwd: RAIZ_REPO,
    env: process.env,
    stdio: ['ignore', log, log],
    detached: !windows, // grupo de processos próprio: o Reset pode parar a corrida inteira
    windowsHide: true,
  });
  const fim = new Promise<void>((ok) => {
    const acabou = (codigo: number | null) => {
      if (tarefa?.processo === processo) tarefa = undefined;
      aoTerminar(codigo);
      ok();
    };
    processo.once('exit', (codigo) => acabou(codigo));
    processo.once('error', () => acabou(null));
  });
  return { tipo, processo, fim };
}

function parar(t: Tarefa): void {
  const pid = t.processo.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-pid, 'SIGTERM');
  } catch {
    // já tinha terminado
  }
}

const registarPainel = (tipo: string, depois: unknown) =>
  auditoria.registar({ hora: new Date().toISOString(), pedidoId: 'painel', tipo, quem: 'painel', depois });

/** POST /iniciar: uma corrida completa da demo, se não houver outra (ou um reset) a decorrer. */
export async function tratarIniciar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await autorizar(req, res))) return;
  if (tarefa) return void texto(res, 409, `Already running (${tarefa.tipo})`);
  // --sem-painel: o painel é este processo; a corrida escreve na auditoria e este ecrã lê-a.
  tarefa = lancar('demo', 'npm run demo -- --sem-painel', (codigo) => registarPainel('painel-demo-terminou', { codigo }));
  registarPainel('painel-iniciar', { comando: 'npm run demo' });
  res.writeHead(303, { Location: '/' }).end();
}

/** POST /limpar: para a corrida, arquiva a auditoria, repõe o repo da app e reabre a 5432 (de propósito, para a demo). */
export async function tratarLimpar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await autorizar(req, res))) return;
  if (tarefa?.tipo === 'reset') return void texto(res, 409, 'Already running (reset)');
  if (tarefa) {
    const anterior = tarefa;
    parar(anterior);
    await Promise.race([anterior.fim, new Promise((ok) => setTimeout(ok, 5000))]);
    tarefa = undefined;
  }
  // A auditoria é só de acréscimo: arquiva-se o ficheiro do ciclo (auditoria*.jsonl está no .gitignore) e começa-se outro.
  const ficheiro = process.env.AUDITORIA_FICHEIRO || join(RAIZ_REPO, 'auditoria.jsonl');
  let arquivo: string | null = null;
  if (existsSync(ficheiro)) {
    arquivo = `${ficheiro.replace(/\.jsonl$/, '')}-ate-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    renameSync(ficheiro, arquivo);
  }
  estado.limparEstado();
  registarPainel('painel-reset', { arquivo: arquivo ? basename(arquivo) : null, acoes: ['repor-repo-app', 'reabrir-5432'] });
  tarefa = lancar('reset', 'bash env/repor-repo-app.sh --sim && npm run lsw:vitima -- reabrir', (codigo) =>
    // A 5432 da vítima volta a ficar aberta de propósito: é o ponto de partida da demo.
    registarPainel(codigo === 0 ? 'vitima-reaberta' : 'painel-reset-falhou', { porta: 5432, codigo, motivo: 'reset da demo' }),
  );
  res.writeHead(303, { Location: '/' }).end();
}

export function iniciarPainel(porta: number, opcoes: OpcoesPainel = {}): Server {
  carregarEnv();
  const desfazer = opcoes.desfazer ?? (async (id: string) => (await import('@mwbe/defesa')).desfazer(id));
  const posts: Record<string, Rota> = {
    '/desfazer': (q, r) => tratarDesfazer(q, r, desfazer),
    '/iniciar': tratarIniciar,
    '/limpar': tratarLimpar,
  };
  const servidor = createServer((req, res) => {
    const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
    const rota: Rota | undefined = req.method === 'GET' ? ROTAS[caminho] : req.method === 'POST' ? posts[caminho] : undefined;
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
