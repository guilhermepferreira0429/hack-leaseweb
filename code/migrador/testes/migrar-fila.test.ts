// migrarFila contra filas temporárias (SQS no LocalStack e RabbitMQ). Não toca nas filas da app nem da seed.
// Saltado se o LocalStack ou o RabbitMQ não estiverem no ar (npm run infra:up) ou sem RABBITMQ_URL.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import * as amqp from 'amqplib';
import { carregarEnv } from '../ambiente';
import { migrarFilaDetalhado } from '../migrar-fila';

carregarEnv();
const RABBITMQ_URL = process.env.RABBITMQ_URL?.trim() ?? '';
const sqs = new SQSClient({
  endpoint: process.env.LOCALSTACK_ENDPOINT?.trim() || 'http://127.0.0.1:4566',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  maxAttempts: 1,
});
const FILA = `migrador-teste-${randomBytes(4).toString('hex')}`;
// 37 mensagens: mais do que um lote de 10, com um corpo repetido, unicode e JSON.
const CORPOS = [
  ...Array.from({ length: 35 }, (_, i) => JSON.stringify({ tipo: 'encomenda-criada', id: `E-${i}`, cliente: 'Café Central — Ç' })),
  'repetida',
  'repetida',
];

async function sondar(): Promise<string | false> {
  if (!RABBITMQ_URL || RABBITMQ_URL.includes('<senha>')) return 'RABBITMQ_URL não definida';
  try {
    await sqs.send(new CreateQueueCommand({ QueueName: `${FILA}-sonda` }), { abortSignal: AbortSignal.timeout(3000) });
    const m = await amqp.connect(RABBITMQ_URL, { timeout: 3000 });
    await m.close();
    return false;
  } catch (erro) {
    return `LocalStack ou RabbitMQ em baixo (npm run infra:up): ${erro instanceof Error ? erro.message : erro}`;
  }
}

const salto = await sondar();

async function contarRabbit(): Promise<number> {
  const m = await amqp.connect(RABBITMQ_URL);
  m.on('error', () => {});
  try {
    const c = await m.createChannel();
    c.on('error', () => {});
    return (await c.checkQueue(FILA)).messageCount;
  } finally {
    await m.close();
  }
}

describe('migrador: migrarFila', { skip: salto }, () => {
  let queueUrl = '';

  before(async () => {
    queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: FILA }))).QueueUrl!;
    for (let i = 0; i < CORPOS.length; i += 10) {
      await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: CORPOS.slice(i, i + 10).map((MessageBody, j) => ({ Id: String(j), MessageBody })),
        }),
      );
    }
  });

  after(async () => {
    for (const nome of [FILA, `${FILA}-sonda`]) {
      const url = (await sqs.send(new CreateQueueCommand({ QueueName: nome })).catch(() => undefined))?.QueueUrl;
      if (url) await sqs.send(new DeleteQueueCommand({ QueueUrl: url })).catch(() => {});
    }
    sqs.destroy();
    const m = await amqp.connect(RABBITMQ_URL).catch(() => undefined);
    if (m) {
      m.on('error', () => {});
      const c = await m.createChannel();
      c.on('error', () => {});
      await c.deleteQueue(FILA).catch(() => {});
      await m.close().catch(() => {});
    }
  });

  it('move todas as mensagens para o RabbitMQ com contagem e sha256 iguais', async () => {
    const r = await migrarFilaDetalhado({ filas: [FILA] });
    assert.deepEqual(r.filas, [{ fila: FILA, mensagens: CORPOS.length, encontradas: CORPOS.length }]);
    assert.equal(r.iguais, true);
  });

  it('a prova não consome: as mensagens continuam no RabbitMQ e o SQS ficou vazio', async () => {
    assert.equal(await contarRabbit(), CORPOS.length);
    const a = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }),
    );
    assert.equal(Number(a.Attributes?.ApproximateNumberOfMessages), 0);
    assert.equal(Number(a.Attributes?.ApproximateNumberOfMessagesNotVisible), 0);
  });

  it('repetir não duplica: o SQS está vazio, 0 mensagens movidas', async () => {
    const r = await migrarFilaDetalhado({ filas: [FILA] });
    assert.deepEqual(r.filas, [{ fila: FILA, mensagens: 0, encontradas: 0 }]);
    assert.equal(await contarRabbit(), CORPOS.length);
  });
});
