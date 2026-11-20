// Credenciais de fábrica e bucket público (nível B de docs/ferramentas.md).
// Uma tentativa por credencial, só leitura: ListBuckets, SELECT 1, PING e GET /api/overview.
// Nunca muda dados e nunca mostra a palavra-passe. A allowlist é conferida antes de cada ligação.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as ligarTcp } from 'node:net';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { Client as PgClient } from 'pg';
import type { Achado } from '@mwbe/shared';
import { garantirPermitido } from './alvos';
import { verificarPortas } from './reconhecimento';

export const TIMEOUT_CREDENCIAL_MS = 3_000;

export interface CredencialPorDefeito {
  servico: string;
  porta: number;
  utilizador: string;
  senha: string;
}

/** Credenciais públicas de fábrica; nenhuma é segredo nosso. */
export const CREDENCIAIS_POR_DEFEITO: readonly CredencialPorDefeito[] = [
  { servico: 'PostgreSQL', porta: 5432, utilizador: 'postgres', senha: 'postgres' },
  { servico: 'MinIO', porta: 9000, utilizador: 'minioadmin', senha: 'minioadmin' },
  { servico: 'RabbitMQ', porta: 15672, utilizador: 'guest', senha: 'guest' },
  { servico: 'Redis', porta: 6379, utilizador: '', senha: 'redis' },
];

export interface OpcoesCredenciais {
  timeoutMs?: number;
}

export interface OpcoesBucket {
  https?: boolean;
  timeoutMs?: number;
}

function paraAchadoCredencial(alvo: string, cred: CredencialPorDefeito): Achado {
  const como = cred.utilizador ? `utilizador '${cred.utilizador}'` : 'sem autenticação';
  return {
    id: `credencial-${alvo}-${cred.porta}`,
    tipo: 'credenciais-por-defeito',
    origem: 'atacante',
    alvo,
    porta: cred.porta,
    servico: cred.servico,
    severidade: 'alta',
    detalhe: `${cred.servico} aceita ${como} com credencial de fábrica`,
  };
}

async function testarPostgres(alvo: string, cred: CredencialPorDefeito, timeoutMs: number): Promise<boolean> {
  const cliente = new PgClient({
    host: alvo,
    port: cred.porta,
    user: cred.utilizador,
    password: cred.senha,
    database: 'postgres',
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'mwbe-atacante',
  });
  try {
    await cliente.connect();
    await cliente.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function testarMinio(alvo: string, cred: CredencialPorDefeito, timeoutMs: number): Promise<boolean> {
  const cliente = new S3Client({
    endpoint: `http://${alvo}:${cred.porta}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: cred.utilizador, secretAccessKey: cred.senha },
    maxAttempts: 1,
  });
  const abortar = new AbortController();
  const timer = setTimeout(() => abortar.abort(), timeoutMs);
  try {
    await cliente.send(new ListBucketsCommand({}), { abortSignal: abortar.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    cliente.destroy();
  }
}

function testarRabbit(alvo: string, cred: CredencialPorDefeito, timeoutMs: number): Promise<boolean> {
  return new Promise((concluir) => {
    const autorizacao = Buffer.from(`${cred.utilizador}:${cred.senha}`).toString('base64');
    const pedido = httpRequest(
      {
        host: alvo,
        port: cred.porta,
        path: '/api/overview',
        method: 'GET',
        timeout: timeoutMs,
        headers: { authorization: `Basic ${autorizacao}`, accept: 'application/json' },
      },
      (resposta) => {
        resposta.resume();
        concluir((resposta.statusCode ?? 0) === 200);
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('timeout')));
    pedido.on('error', () => concluir(false));
    pedido.end();
  });
}

function testarRedis(alvo: string, cred: CredencialPorDefeito, timeoutMs: number): Promise<boolean> {
  return new Promise((concluir) => {
    const socket = ligarTcp({ host: alvo, port: cred.porta });
    let dados = '';
    let terminado = false;
    const fim = (ok: boolean) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      concluir(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write(`AUTH ${cred.senha}\r\nPING\r\n`));
    socket.on('data', (bloco) => {
      dados += bloco.toString('utf8');
      // Sem palavra-passe o Redis recusa o AUTH mas responde +PONG; com a de fábrica, idem.
      if (dados.includes('+PONG')) fim(true);
    });
    socket.on('timeout', () => fim(false));
    socket.on('error', () => fim(false));
    socket.on('close', () => fim(false));
  });
}

/**
 * Testa as credenciais de fábrica nos serviços que estiverem abertos.
 * Cada serviço leva uma única tentativa e só operações de leitura.
 */
export async function testarCredenciaisPorDefeito(
  alvo: string,
  allowlist: ReadonlySet<string>,
  opcoes: OpcoesCredenciais = {},
): Promise<Achado[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_CREDENCIAL_MS;

  // Só vale a pena tentar credenciais em portas que respondem; as fechadas ficam de fora.
  const portas = [...new Set(CREDENCIAIS_POR_DEFEITO.map((c) => c.porta))];
  const abertas = new Set(
    (await verificarPortas(endereco, allowlist, portas))
      .filter((p) => p.estado === 'aberta')
      .map((p) => p.porta),
  );

  const achados: Achado[] = [];
  for (const cred of CREDENCIAIS_POR_DEFEITO) {
    if (!abertas.has(cred.porta)) continue;
    // Guarda antes de CADA tentativa de credencial.
    garantirPermitido(endereco, allowlist);

    let entrou = false;
    if (cred.servico === 'PostgreSQL') entrou = await testarPostgres(endereco, cred, timeoutMs);
    else if (cred.servico === 'MinIO') entrou = await testarMinio(endereco, cred, timeoutMs);
    else if (cred.servico === 'RabbitMQ') entrou = await testarRabbit(endereco, cred, timeoutMs);
    else if (cred.servico === 'Redis') entrou = await testarRedis(endereco, cred, timeoutMs);

    if (entrou) achados.push(paraAchadoCredencial(endereco, cred));
  }
  return achados;
}

/**
 * Testa se um bucket S3/MinIO responde a um listagem anónima (path-style).
 * Um 200 com ListBucketResult significa leitura pública; 403/404 não é achado.
 */
export async function verificarBucketPublico(
  alvo: string,
  porta: number,
  bucket: string,
  allowlist: ReadonlySet<string>,
  opcoes: OpcoesBucket = {},
): Promise<Achado[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);
  const nome = bucket.trim();
  if (!nome) return [];
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_CREDENCIAL_MS;
  const caminho = `/${encodeURIComponent(nome)}?list-type=2`;

  const publico = await new Promise<boolean>((concluir) => {
    const pedido = (opcoes.https ? httpsRequest : httpRequest)(
      {
        host: endereco,
        port: porta,
        path: caminho,
        method: 'GET',
        timeout: timeoutMs,
        headers: { accept: 'application/xml' },
      },
      (resposta) => {
        if ((resposta.statusCode ?? 0) !== 200) {
          resposta.resume();
          concluir(false);
          return;
        }
        let texto = '';
        resposta.setEncoding('utf8');
        resposta.on('data', (bloco: string) => {
          texto += bloco;
          if (texto.length > 64 * 1024) resposta.destroy();
        });
        resposta.on('end', () => concluir(texto.includes('<ListBucketResult')));
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('timeout')));
    pedido.on('error', () => concluir(false));
    pedido.end();
  });

  if (!publico) return [];
  return [
    {
      id: `bucket-${endereco}-${porta}-${nome}`,
      tipo: 'servico-exposto',
      origem: 'atacante',
      alvo: endereco,
      porta,
      servico: 'MinIO (bucket público)',
      severidade: 'alta',
      detalhe: `bucket "${nome}" listável sem credenciais`,
    },
  ];
}
