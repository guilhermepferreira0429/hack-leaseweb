// Testes da seed (npm run seed): leem uma fatura, uma encomenda e uma mensagem.
// Os de infraestrutura seguem as variáveis da app, por isso servem a origem (LocalStack) e,
// depois da migração, o destino (ARMAZENAMENTO_ENDPOINT=MinIO). Sem infraestrutura ou sem seed
// são saltados; com VERIFICACAO_ESTRITA=1 falham.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { carregarEnvLocal, clienteS3, lerAmbiente } from '../adaptadores';
import {
  BUCKET_FATURAS,
  ESQUEMA,
  FILA_ENCOMENDAS,
  gerarDados,
  gerarFaturaPdf,
  nifValido,
  QUANTIDADES,
  sha256Hex,
} from '../seed';

carregarEnvLocal();
const ESTRITA = process.env.VERIFICACAO_ESTRITA === '1';
const dados = gerarDados();

describe('seed: dados gerados (sem infraestrutura)', () => {
  it('a mesma semente dá sempre os mesmos dados', () => {
    assert.equal(JSON.stringify(gerarDados()), JSON.stringify(dados));
  });

  it('tem as quantidades pedidas e NIF com dígito de controlo válido, nunca atribuíveis (prefixo 49)', () => {
    assert.equal(dados.clientes.length, QUANTIDADES.clientes);
    assert.equal(dados.produtos.length, QUANTIDADES.produtos);
    assert.equal(dados.encomendas.length, QUANTIDADES.encomendas);
    assert.equal(dados.faturas.length, QUANTIDADES.faturas);
    assert.equal(dados.fotos.length, QUANTIDADES.fotos);
    assert.equal(dados.mensagens.length, QUANTIDADES.mensagens);
    for (const c of dados.clientes) {
      assert.ok(nifValido(c.nif) && c.nif.startsWith('49'), `NIF ${c.nif}`);
      assert.ok(c.email.endsWith('.example'), `email ${c.email}`);
    }
    assert.equal(new Set(dados.clientes.map((c) => c.nif)).size, dados.clientes.length, 'NIF únicos');
  });

  it('esperado.json bate com as quantidades', (t) => {
    const caminho = fileURLToPath(new URL('../seed/esperado.json', import.meta.url));
    if (!existsSync(caminho)) return t.skip('ainda não há esperado.json (npm run seed)');
    const esperado = JSON.parse(readFileSync(caminho, 'utf8'));
    assert.equal(esperado.buckets.faturas.objetos, QUANTIDADES.faturas);
    assert.equal(esperado.buckets['fotos-produtos'].objetos, QUANTIDADES.fotos);
    assert.equal(esperado.tabelas.clientes.linhas, QUANTIDADES.clientes);
    assert.equal(esperado.tabelas.encomendas.linhas, QUANTIDADES.encomendas);
    assert.equal(esperado.tabelas.linhas_encomenda.linhas, dados.linhas.length);
    assert.equal(esperado.filas[FILA_ENCOMENDAS].mensagens, QUANTIDADES.mensagens);
  });
});

// ---------------------------------------------------------------- com infraestrutura

const amb = (() => {
  try {
    return lerAmbiente();
  } catch {
    return undefined;
  }
})();

async function sondar(): Promise<string | null> {
  if (!amb) return 'DATABASE_URL não definida';
  const s3 = clienteS3(amb.armazenamento);
  const bd = new pg.Client({ connectionString: amb.databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await bd.connect();
    const r = await bd.query<{ t: string | null }>(`SELECT to_regclass('${ESQUEMA}.encomendas')::text AS t`);
    if (!r.rows[0]?.t) return `sem o esquema ${ESQUEMA} (npm run seed)`;
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_FATURAS, Key: dados.faturas[0]!.chave }), { abortSignal: AbortSignal.timeout(8000) });
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message || erro.name : String(erro);
  } finally {
    s3.destroy();
    await bd.end().catch(() => {});
  }
}

const motivo = ESTRITA ? null : await sondar();
const salto = motivo ? `infraestrutura ou seed em falta (npm run infra:up; npm run seed): ${motivo}` : false;

describe('seed: ler da infraestrutura', { skip: salto }, () => {
  let s3: S3Client;
  let sqs: SQSClient;
  let bd: pg.Client;

  before(async () => {
    if (!amb) throw new Error('DATABASE_URL não definida');
    s3 = clienteS3(amb.armazenamento);
    sqs = new SQSClient({
      endpoint: amb.fila.endpoint,
      region: amb.fila.regiao,
      credentials: { accessKeyId: amb.fila.accessKey, secretAccessKey: amb.fila.secretKey },
      maxAttempts: 2,
    });
    bd = new pg.Client({ connectionString: amb.databaseUrl, connectionTimeoutMillis: 5000 });
    await bd.connect();
  });

  after(async () => {
    s3?.destroy();
    sqs?.destroy();
    await bd?.end().catch(() => {});
  });

  it('lê a fatura FT-2026-0001.pdf e é byte a byte a que a seed gerou', async () => {
    const fatura = dados.faturas[0]!;
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET_FATURAS, Key: fatura.chave }));
    const corpo = Buffer.from(await r.Body!.transformToByteArray());
    assert.equal(corpo.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    assert.ok(corpo.toString('latin1').includes(`Fatura ${fatura.numero}`), 'o título do PDF tem o número da fatura');

    const encomenda = dados.encomendas.find((e) => e.id === fatura.encomendaId)!;
    const gerado = gerarFaturaPdf({
      fatura,
      encomenda,
      cliente: dados.clientes.find((c) => c.id === encomenda.clienteId)!,
      linhas: dados.linhas.filter((l) => l.encomendaId === encomenda.id),
      produtos: new Map(dados.produtos.map((p) => [p.id, p])),
    });
    assert.equal(sha256Hex(corpo), sha256Hex(gerado));
  });

  it('lê a encomenda da fatura FT-2026-0001, com cliente e linhas a somar o total', async () => {
    const { rows } = await bd.query<{ numero: string; nif: string; subtotal: number; iva: number; total: number; soma: number; linhas: number }>(
      `SELECT e.numero, c.nif, e.subtotal_centimos AS subtotal, e.iva_centimos AS iva, e.total_centimos AS total,
              sum(l.subtotal_centimos + l.iva_centimos)::int AS soma, count(l.id)::int AS linhas
         FROM ${ESQUEMA}.encomendas e
         JOIN ${ESQUEMA}.clientes c ON c.id = e.cliente_id
         JOIN ${ESQUEMA}.linhas_encomenda l ON l.encomenda_id = e.id
        WHERE e.fatura_numero = $1
        GROUP BY e.id, c.nif`,
      [dados.faturas[0]!.numero],
    );
    assert.equal(rows.length, 1, 'uma encomenda com essa fatura');
    const e = rows[0]!;
    const original = dados.encomendas.find((x) => x.id === dados.faturas[0]!.encomendaId)!;
    assert.equal(e.numero, original.numero);
    assert.ok(nifValido(e.nif));
    assert.equal(e.total, e.subtotal + e.iva);
    assert.equal(e.soma, e.total, 'as linhas somam o total');
    assert.equal(e.total, original.totalCentimos);
  });

  it('lê uma mensagem da fila encomendas-novas sem a consumir, e a encomenda existe como "nova"', async () => {
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: FILA_ENCOMENDAS }));
    // VisibilityTimeout 0: a mensagem fica logo visível outra vez; o teste não estraga a fila.
    const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 1, VisibilityTimeout: 0, WaitTimeSeconds: 2 }));
    const corpo = r.Messages?.[0]?.Body;
    assert.ok(corpo, `a fila ${FILA_ENCOMENDAS} tem mensagens`);
    assert.ok(dados.mensagens.includes(corpo), 'a mensagem é uma das que a seed enviou');
    const m = JSON.parse(corpo) as { tipo: string; encomenda: string; totalCentimos: number };
    assert.equal(m.tipo, 'encomenda-nova');
    const { rows } = await bd.query<{ estado: string; total: number }>(
      `SELECT estado, total_centimos AS total FROM ${ESQUEMA}.encomendas WHERE numero = $1`,
      [m.encomenda],
    );
    assert.deepEqual(rows[0], { estado: 'nova', total: m.totalCentimos });
  });
});
