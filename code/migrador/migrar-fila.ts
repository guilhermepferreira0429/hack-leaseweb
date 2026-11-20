// SQS (LocalStack) -> RabbitMQ (Leaseweb), fila a fila, sem perder mensagens:
// recebe do SQS, publica no RabbitMQ (persistente, publisher confirms) e só depois apaga no SQS.
// Prova: contagem e sha256 dos corpos. O destino relê-se sem consumir (get sem ack e nack com requeue).
import { createHash } from 'node:crypto';
import {
  DeleteMessageBatchCommand,
  ListQueuesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import * as amqp from 'amqplib';
import { carregarEnv } from './ambiente';

export interface ResultadoFila {
  fila: string;
  /** Mensagens movidas do SQS para o RabbitMQ nesta execução. */
  mensagens: number;
  /** Quantas dessas se voltaram a encontrar no RabbitMQ com o mesmo sha256. */
  encontradas: number;
  /** Mensagens que o RabbitMQ já tinha antes desta execução (devia ser 0: senão há duplicados). */
  preexistentes: number;
  /** Total na fila do RabbitMQ no fim. */
  noDestino: number;
}

const sha = (texto: string): string => createHash('sha256').update(texto).digest('hex');

function lerFilas(): { sqsEndpoint: string; regiao: string; rabbitmqUrl: string } {
  carregarEnv();
  const v = (nome: string): string | undefined => process.env[nome]?.trim() || undefined;
  const rabbitmqUrl = v('RABBITMQ_URL');
  if (!rabbitmqUrl || rabbitmqUrl.includes('<senha>')) throw new Error('RABBITMQ_URL não está definida no .env');
  return { sqsEndpoint: v('LOCALSTACK_ENDPOINT') ?? 'http://127.0.0.1:4566', regiao: v('AWS_REGION') ?? 'us-east-1', rabbitmqUrl };
}

function hostDe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5672'}`;
  } catch {
    return '(URL inválido)';
  }
}

/** Move uma fila. Devolve os sha256 dos corpos movidos e quantas mensagens o destino já tinha. */
async function moverFila(
  sqs: SQSClient,
  queueUrl: string,
  canal: amqp.ConfirmChannel,
  nome: string,
): Promise<{ hashes: string[]; preexistentes: number }> {
  const { messageCount: preexistentes } = await canal.assertQueue(nome, { durable: true });
  const hashes: string[] = [];
  // O SQS pode devolver vazio mesmo com mensagens: só se dá por terminado à 2.ª resposta vazia seguida.
  for (let vazias = 0; vazias < 2; ) {
    const r = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 60 }),
    );
    const mensagens = r.Messages ?? [];
    if (mensagens.length === 0) {
      vazias++;
      continue;
    }
    vazias = 0;
    for (const m of mensagens) {
      const corpo = m.Body ?? '';
      canal.sendToQueue(nome, Buffer.from(corpo), { persistent: true, messageId: m.MessageId });
      hashes.push(sha(corpo));
    }
    // Só depois de o RabbitMQ confirmar é que se apaga no SQS. Se falhar, as mensagens voltam a ficar
    // visíveis no SQS ao fim do VisibilityTimeout: nada se perde (no pior caso há um duplicado).
    await canal.waitForConfirms();
    await sqs.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: mensagens.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
      }),
    );
  }
  return { hashes, preexistentes };
}

/** Lê todos os corpos da fila sem os consumir: get sem ack e, no fim, nack com requeue. */
async function lerSemConsumir(modelo: amqp.ChannelModel, nome: string): Promise<string[]> {
  const canal = await modelo.createChannel();
  canal.on('error', () => {});
  try {
    const hashes: string[] = [];
    let ultima: amqp.GetMessage | undefined;
    for (;;) {
      const m = await canal.get(nome, { noAck: false });
      if (!m) break;
      hashes.push(sha(m.content.toString()));
      ultima = m;
    }
    if (ultima) canal.nack(ultima, true, true);
    return hashes;
  } finally {
    await canal.close().catch(() => {});
  }
}

/**
 * Versão com o detalhe por fila (para o CLI e o painel).
 * `opcoes.filas`: só estas filas (os testes usam-no com filas temporárias); por omissão, todas.
 */
export async function migrarFilaDetalhado(opcoes: { filas?: string[] } = {}): Promise<{ filas: ResultadoFila[]; iguais: boolean }> {
  const cfg = lerFilas();
  const sqs = new SQSClient({
    endpoint: cfg.sqsEndpoint,
    region: cfg.regiao,
    // O LocalStack aceita quaisquer credenciais; "test" é a convenção dele, não é um segredo.
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 2,
  });
  let modelo: amqp.ChannelModel | undefined;
  try {
    let urls: string[];
    try {
      urls = (await sqs.send(new ListQueuesCommand({}), { abortSignal: AbortSignal.timeout(8000) })).QueueUrls ?? [];
    } catch {
      throw new Error(`SQS (LocalStack) não responde em ${cfg.sqsEndpoint}`);
    }
    try {
      modelo = await amqp.connect(cfg.rabbitmqUrl);
    } catch (erro) {
      const porque = /ACCESS_REFUSED|403/.test(String(erro)) ? 'recusou as credenciais' : 'não responde';
      throw new Error(`RabbitMQ ${porque} em ${hostDe(cfg.rabbitmqUrl)}`);
    }
    modelo.on('error', () => {});
    const canal = await modelo.createConfirmChannel();
    canal.on('error', () => {});

    const filas: ResultadoFila[] = [];
    for (const url of urls.sort()) {
      const nome = decodeURIComponent(url.split('/').pop() ?? '');
      if (!nome || (opcoes.filas && !opcoes.filas.includes(nome))) continue;
      const { hashes: movidas, preexistentes } = await moverFila(sqs, url, canal, nome);
      // Prova: cada corpo movido aparece no RabbitMQ com o mesmo sha256 (contando repetidos).
      const hashesDestino = await lerSemConsumir(modelo, nome);
      const noDestino = new Map<string, number>();
      for (const h of hashesDestino) noDestino.set(h, (noDestino.get(h) ?? 0) + 1);
      let encontradas = 0;
      for (const h of movidas) {
        const n = noDestino.get(h) ?? 0;
        if (n > 0) {
          encontradas++;
          noDestino.set(h, n - 1);
        }
      }
      filas.push({ fila: nome, mensagens: movidas.length, encontradas, preexistentes, noDestino: hashesDestino.length });
    }
    await canal.close().catch(() => {});
    // Igual só se o destino ficou exatamente com o que se moveu nesta execução: sem perdas e sem
    // mensagens de antes (que seriam duplicados de uma migração anterior; limpar com seed:limpar-destino).
    const iguais = filas.every((f) => f.encontradas === f.mensagens && f.preexistentes === 0 && f.noDestino === f.mensagens);
    return { filas, iguais };
  } finally {
    sqs.destroy();
    await modelo?.close().catch(() => {});
  }
}

/** Move as mensagens de todas as filas SQS para o RabbitMQ e compara contagem e sha256 dos corpos. */
export async function migrarFila(): Promise<{ mensagens: number; iguais: boolean }> {
  const r = await migrarFilaDetalhado();
  return { mensagens: r.filas.reduce((s, f) => s + f.mensagens, 0), iguais: r.iguais };
}
