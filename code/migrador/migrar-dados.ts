// S3 (LocalStack) -> MinIO, com verificação por sha256 de cada objeto.
// Postgres e fila ficam fora hoje (slide), ver docs/plano.md.
import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { lerAmbienteMigrador } from './ambiente';
import type { Lado } from './ambiente';

export interface ChecksumObjeto {
  chave: string;
  origem: string;
  destino: string;
}

/** Quantos objetos se copiam ao mesmo tempo. */
const EM_PARALELO = 8;

/** sha256 em hex de um corpo. */
export function sha256(conteudo: Uint8Array): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

function cliente(lado: Lado): S3Client {
  return new S3Client({
    endpoint: lado.endpoint,
    region: lado.regiao,
    forcePathStyle: true,
    credentials: { accessKeyId: lado.accessKey, secretAccessKey: lado.secretKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
}

function estadoHttp(erro: unknown): number | undefined {
  return (erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** Falha cedo, com uma mensagem que o dono percebe, se um dos lados não responde. */
async function sondar(s3: S3Client, lado: Lado): Promise<void> {
  try {
    await s3.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(8000) });
  } catch (erro) {
    const estado = estadoHttp(erro);
    const porque = estado === 403 ? 'recusou as credenciais (403)' : 'não responde';
    throw new Error(`${lado.nome} ${porque} em ${lado.endpoint}`);
  }
}

async function lerObjeto(s3: S3Client, bucket: string, chave: string): Promise<{ corpo: Uint8Array; tipo?: string }> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
  if (!r.Body) throw new Error(`Objeto sem corpo: ${chave}`);
  return { corpo: await r.Body.transformToByteArray(), tipo: r.ContentType };
}

async function listarChaves(s3: S3Client, bucket: string): Promise<string[]> {
  const chaves: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) chaves.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return chaves;
}

async function garantirBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (erro) {
    if (estadoHttp(erro) !== 404) throw erro;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

/** Corre `trabalho` sobre todos os itens, no máximo `n` de cada vez, mantendo a ordem do resultado. */
async function emLotes<T, R>(itens: T[], n: number, trabalho: (item: T) => Promise<R>): Promise<R[]> {
  const resultado = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultado[i] = await trabalho(itens[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return resultado;
}

/** Confirma que o LocalStack e o MinIO respondem; lança com uma mensagem clara se não. */
export async function sondarArmazenamento(): Promise<void> {
  const amb = lerAmbienteMigrador();
  const origem = cliente(amb.origem);
  const destino = cliente(amb.destino);
  try {
    await Promise.all([sondar(origem, amb.origem), sondar(destino, amb.destino)]);
  } finally {
    origem.destroy();
    destino.destroy();
  }
}

/**
 * Versão com o detalhe por objeto (para o CLI e o painel). O sha256 do destino calcula-se
 * a partir do que se volta a ler do MinIO, não do que se enviou.
 */
export async function migrarS3Detalhado(): Promise<{ bucket: string; objetos: ChecksumObjeto[]; checksumsOk: boolean }> {
  const amb = lerAmbienteMigrador();
  const origem = cliente(amb.origem);
  const destino = cliente(amb.destino);
  try {
    await Promise.all([sondar(origem, amb.origem), sondar(destino, amb.destino)]);

    let chaves: string[];
    try {
      chaves = await listarChaves(origem, amb.bucket);
    } catch (erro) {
      if (estadoHttp(erro) === 404) throw new Error(`O bucket ${amb.bucket} não existe no ${amb.origem.nome}`);
      throw erro;
    }
    if (chaves.length === 0) {
      throw new Error(`O bucket ${amb.bucket} no ${amb.origem.nome} está vazio: nada para migrar (npm run dev:exemplo -- --semear 20)`);
    }

    await garantirBucket(destino, amb.bucket);

    const objetos = await emLotes(chaves, EM_PARALELO, async (chave): Promise<ChecksumObjeto> => {
      const { corpo, tipo } = await lerObjeto(origem, amb.bucket, chave);
      await destino.send(new PutObjectCommand({ Bucket: amb.bucket, Key: chave, Body: corpo, ContentType: tipo }));
      const copia = await lerObjeto(destino, amb.bucket, chave);
      return { chave, origem: sha256(corpo), destino: sha256(copia.corpo) };
    });

    return { bucket: amb.bucket, objetos, checksumsOk: objetos.every((o) => o.origem === o.destino) };
  } finally {
    origem.destroy();
    destino.destroy();
  }
}

/** Lista o bucket na origem, copia cada objeto para o MinIO e compara sha256 dos dois lados. */
export async function migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }> {
  const r = await migrarS3Detalhado();
  return { objetos: r.objetos.length, checksumsOk: r.checksumsOk };
}
