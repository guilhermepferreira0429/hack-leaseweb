// npm run seed:comparar              -> confere a origem (LocalStack + DATABASE_URL) com esperado.json
// npm run seed:comparar -- --destino -> confere o destino (MinIO + DATABASE_URL_DESTINO) com esperado.json
// Prova independente do migrador: recalcula os checksums do zero e compara-os com os que a seed gravou.
// Só lê. Sai com código 1 se alguma coisa não bater.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import * as amqp from 'amqplib';
import pg from 'pg';
import { carregarEnvLocal, clienteS3 } from '../adaptadores';
import { checksumBucket, checksumTabela } from './checksums';
import type { ResumoBucket, ResumoTabela } from './checksums';

const CAMINHO_ESPERADO = fileURLToPath(new URL('./esperado.json', import.meta.url));

interface Esperado {
  esquema: string;
  buckets: Record<string, ResumoBucket & { filtro: string }>;
  tabelas: Record<string, ResumoTabela>;
  filas: Record<string, { mensagens: number; checksum: string }>;
}

export interface LinhaComparacao {
  tipo: 's3' | 'pg' | 'sqs' | 'amqp';
  nome: string;
  esperado: string;
  encontrado: string;
  ok: boolean | null; // null: não comparado (e porquê, em `encontrado`)
}

export interface Lado {
  nome: string;
  s3: { endpoint: string; accessKey: string; secretKey: string; regiao: string };
  databaseUrl?: string;
  /** A origem tem SQS; o destino tem RabbitMQ. Das filas só se compara a contagem (ler os corpos consumia-as). */
  sqsEndpoint?: string;
  rabbitmqUrl?: string;
}

const v = (nome: string): string | undefined => process.env[nome]?.trim() || undefined;

export function lerLado(destino: boolean): Lado {
  const regiao = v('AWS_REGION') ?? 'us-east-1';
  const localstack = v('LOCALSTACK_ENDPOINT') ?? 'http://127.0.0.1:4566';
  if (!destino) {
    return {
      nome: `origem (LocalStack ${localstack})`,
      // O LocalStack aceita quaisquer credenciais; "test" é a convenção dele, não é um segredo.
      s3: { endpoint: localstack, accessKey: 'test', secretKey: 'test', regiao },
      databaseUrl: v('DATABASE_URL'),
      sqsEndpoint: localstack,
    };
  }
  const accessKey = v('MINIO_ACCESS_KEY');
  const secretKey = v('MINIO_SECRET_KEY');
  if (!accessKey || !secretKey) throw new Error('MINIO_ACCESS_KEY e MINIO_SECRET_KEY não estão definidas no .env');
  const endpoint = v('MINIO_ENDPOINT') ?? 'http://127.0.0.1:9000';
  const rabbitmqUrl = v('RABBITMQ_URL');
  return {
    nome: `destino (MinIO ${endpoint})`,
    s3: { endpoint, accessKey, secretKey, regiao },
    databaseUrl: v('DATABASE_URL_DESTINO'),
    rabbitmqUrl: rabbitmqUrl && !rabbitmqUrl.includes('<senha>') ? rabbitmqUrl : undefined,
  };
}

const curto = (h: string): string => (/^[0-9a-f]{64}$/.test(h) ? `${h.slice(0, 12)}…` : h);

export async function comparar(lado: Lado, esperado: Esperado = JSON.parse(readFileSync(CAMINHO_ESPERADO, 'utf8'))): Promise<LinhaComparacao[]> {
  const linhas: LinhaComparacao[] = [];

  const s3 = clienteS3(lado.s3);
  try {
    for (const [bucket, e] of Object.entries(esperado.buckets)) {
      const fmt = (r: ResumoBucket): string => `${r.objetos} obj ${curto(r.checksum)}`;
      try {
        const r = await checksumBucket(s3, bucket, new RegExp(e.filtro));
        linhas.push({ tipo: 's3', nome: bucket, esperado: fmt(e), encontrado: fmt(r), ok: r.objetos === e.objetos && r.checksum === e.checksum });
      } catch (erro) {
        const estado = (erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        linhas.push({ tipo: 's3', nome: bucket, esperado: fmt(e), encontrado: estado === 404 ? 'bucket não existe' : String((erro as Error).message), ok: false });
      }
    }
  } finally {
    s3.destroy();
  }

  for (const [tabela, e] of Object.entries(esperado.tabelas)) {
    const nome = `${esperado.esquema}.${tabela}`;
    const fmt = (r: ResumoTabela): string => `${r.linhas} linhas ${curto(r.checksum)}`;
    if (!lado.databaseUrl || lado.databaseUrl.includes('<senha>')) {
      linhas.push({ tipo: 'pg', nome, esperado: fmt(e), encontrado: 'sem URL da base de dados no .env', ok: null });
      continue;
    }
    const cliente = new pg.Client({ connectionString: lado.databaseUrl, connectionTimeoutMillis: 5000 });
    try {
      await cliente.connect();
      const r = await checksumTabela(cliente, esperado.esquema, tabela);
      linhas.push({ tipo: 'pg', nome, esperado: fmt(e), encontrado: fmt(r), ok: r.linhas === e.linhas && r.checksum === e.checksum });
    } catch (erro) {
      linhas.push({ tipo: 'pg', nome, esperado: fmt(e), encontrado: (erro as Error).message, ok: false });
    } finally {
      await cliente.end().catch(() => {});
    }
  }

  for (const [fila, e] of Object.entries(esperado.filas)) {
    if (!lado.sqsEndpoint) {
      if (!lado.rabbitmqUrl) {
        linhas.push({ tipo: 'amqp', nome: fila, esperado: `${e.mensagens} msg`, encontrado: 'sem RABBITMQ_URL no .env', ok: null });
        continue;
      }
      try {
        const ligacao = await amqp.connect(lado.rabbitmqUrl);
        // Sem estes ouvintes, um canal fechado pelo servidor (ex.: 404 fila inexistente) mata o processo.
        ligacao.on('error', () => {});
        try {
          const canal = await ligacao.createChannel();
          canal.on('error', () => {});
          const { messageCount } = await canal.checkQueue(fila);
          linhas.push({ tipo: 'amqp', nome: fila, esperado: `${e.mensagens} msg`, encontrado: `${messageCount} msg`, ok: messageCount === e.mensagens });
        } finally {
          await ligacao.close().catch(() => {});
        }
      } catch (erro) {
        const texto = (erro as Error).message ?? String(erro);
        linhas.push({ tipo: 'amqp', nome: fila, esperado: `${e.mensagens} msg`, encontrado: /404|NOT_FOUND/.test(texto) ? 'fila ainda não existe (por migrar)' : texto, ok: false });
      }
      continue;
    }
    // Só conta: ler os corpos para o checksum obrigaria a receber as mensagens (e a mexer na fila).
    const sqs = new SQSClient({ endpoint: lado.sqsEndpoint, region: lado.s3.regiao, credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, maxAttempts: 2 });
    try {
      const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: fila }));
      const a = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }));
      const n = Number(a.Attributes?.ApproximateNumberOfMessages ?? 0) + Number(a.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
      linhas.push({ tipo: 'sqs', nome: fila, esperado: `${e.mensagens} msg`, encontrado: `${n} msg`, ok: n === e.mensagens });
    } catch (erro) {
      linhas.push({ tipo: 'sqs', nome: fila, esperado: `${e.mensagens} msg`, encontrado: (erro as Error).message || (erro as Error).name, ok: false });
    } finally {
      sqs.destroy();
    }
  }
  return linhas;
}

async function main(): Promise<void> {
  carregarEnvLocal();
  const lado = lerLado(process.argv.includes('--destino'));
  console.log(`[seed:comparar] ${lado.nome} contra seed/esperado.json`);
  const linhas = await comparar(lado);
  for (const l of linhas) {
    const marca = l.ok === null ? '--' : l.ok ? 'OK' : 'XX';
    console.log(`  ${marca}  ${l.tipo.padEnd(4)}  ${l.nome.padEnd(22)}  esperado ${l.esperado.padEnd(28)}  encontrado ${l.encontrado}`);
  }
  const falhas = linhas.filter((l) => l.ok === false).length;
  const comparados = linhas.filter((l) => l.ok !== null).length;
  console.log(`[seed:comparar] ${comparados - falhas}/${comparados} iguais${falhas ? `; ${falhas} DIFERENTES` : ''}`);
  if (falhas) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('seed/comparar.ts')) {
  main().catch((erro) => {
    console.error('[seed:comparar]', erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
