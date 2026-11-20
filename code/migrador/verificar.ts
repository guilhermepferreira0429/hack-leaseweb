// Mesmos testes da exemplo-app dos dois lados: antes (LocalStack + Postgres de origem) e depois
// (Leaseweb: MinIO e, se já foram migrados, o Postgres de destino e o RabbitMQ).
// Corre os testes de code/exemplo-app/testes num processo à parte, com as variáveis de cada ambiente.
// VERIFICACAO_ESTRITA=1: com a infraestrutura em baixo ou sem dados, os testes falham em vez de saltar.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import * as amqp from 'amqplib';
import pg from 'pg';
import { envDaApp, lerAmbienteMigrador, lerPostgres, RAIZ_REPO } from './ambiente';
import { sondarArmazenamento } from './migrar-dados';

const FICHEIRO_TESTES = join(RAIZ_REPO, 'code', 'exemplo-app', 'testes', 'app.test.ts');
const LIMITE_MS = 120_000;

export interface ResultadoTestes {
  ok: boolean;
  /** Linhas "ok"/"not ok" e motivos de falha, para log. Sem variáveis de ambiente. */
  resumo: string;
}

function correrTestes(envExtra: Record<string, string>): Promise<ResultadoTestes> {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', FICHEIRO_TESTES], {
      cwd: RAIZ_REPO,
      env: { ...process.env, ...envExtra, VERIFICACAO_ESTRITA: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: LIMITE_MS,
    });
    let saida = '';
    filho.stdout.on('data', (b: Buffer) => (saida += b.toString()));
    filho.stderr.on('data', (b: Buffer) => (saida += b.toString()));
    const fim = (ok: boolean, extra = ''): void => {
      const linhas = saida
        .split(/\r?\n/)
        .filter((l) => /^\s*(not ok|ok) \d+ - /.test(l) || /^\s*(error|# (pass|fail)):?/.test(l))
        .map((l) => l.trim());
      resolver({ ok, resumo: [...linhas, extra].filter(Boolean).join('\n') });
    };
    filho.on('error', (erro) => fim(false, `não arrancou: ${erro.message}`));
    filho.on('close', (codigo, sinal) => fim(codigo === 0, sinal ? `terminado por ${sinal} (limite ${LIMITE_MS / 1000} s)` : ''));
  });
}

/** URL do Postgres de destino se o Postgres já foi migrado (o destino responde e tem tabelas). */
async function postgresMigrado(): Promise<string | undefined> {
  let destino: string;
  try {
    destino = lerPostgres().destino;
  } catch {
    return undefined; // nível B não configurado
  }
  const c = new pg.Client({ connectionString: destino, connectionTimeoutMillis: 3000 });
  c.on('error', () => {});
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    return (rows[0]?.n ?? 0) > 0 ? destino : undefined;
  } catch {
    return undefined;
  } finally {
    await c.end().catch(() => {});
  }
}

/** URL do RabbitMQ se a fila da app já foi migrada (o RabbitMQ responde e tem a fila). */
async function filaMigrada(): Promise<string | undefined> {
  const url = process.env.RABBITMQ_URL?.trim();
  if (!url || url.includes('<senha>')) return undefined; // nível B não configurado
  const nome = process.env.FILA_NOME?.trim() || 'encomendas-criadas';
  let modelo: amqp.ChannelModel | undefined;
  try {
    modelo = await amqp.connect(url, { timeout: 3000 });
    modelo.on('error', () => {});
    const canal = await modelo.createChannel();
    canal.on('error', () => {});
    await canal.checkQueue(nome); // falha (404) se a fila não existe
    return url;
  } catch {
    return undefined;
  } finally {
    await modelo?.close().catch(() => {});
  }
}

/** Versão com o resumo de cada lado (para o CLI e logs). */
export async function verificarDetalhado(): Promise<{
  antes: ResultadoTestes;
  depois: ResultadoTestes;
  /** Serviços que, no "depois", já estão na Leaseweb. */
  naLeaseweb: ('s3' | 'postgres' | 'fila')[];
}> {
  await sondarArmazenamento();
  const amb = lerAmbienteMigrador();
  const [pgDestino, rabbitmq] = await Promise.all([postgresMigrado(), filaMigrada()]);
  const depoisEnv = {
    ...envDaApp(amb.destino, amb.bucket),
    ...(pgDestino ? { DATABASE_URL: pgDestino } : {}),
    ...(rabbitmq ? { FILA_TIPO: 'rabbitmq', RABBITMQ_URL: rabbitmq } : {}),
  };
  // Em sequência: os dois lados podem partilhar a base de dados e a fila.
  const antes = await correrTestes({ ...envDaApp(amb.origem, amb.bucket), FILA_TIPO: 'sqs' });
  const depois = await correrTestes(depoisEnv);
  const naLeaseweb: ('s3' | 'postgres' | 'fila')[] = ['s3'];
  if (pgDestino) naLeaseweb.push('postgres');
  if (rabbitmq) naLeaseweb.push('fila');
  return { antes, depois, naLeaseweb };
}

export async function verificar(): Promise<{ antes: boolean; depois: boolean }> {
  const r = await verificarDetalhado();
  return { antes: r.antes.ok, depois: r.depois.ok };
}
