// Adaptadores da app de exemplo. A app só conhece estas interfaces; o ambiente
// (AWS via LocalStack, ou Leaseweb com MinIO) escolhe-se por variáveis de ambiente.
//   ARMAZENAMENTO_ENDPOINT, ARMAZENAMENTO_BUCKET, ARMAZENAMENTO_ACCESS_KEY, ARMAZENAMENTO_SECRET_KEY
//   DATABASE_URL
//   FILA_URL, FILA_NOME (SQS no LocalStack)
import { naoImplementado } from '@mwbe/shared';

export interface Armazenamento {
  guardar(chave: string, conteudo: Buffer, tipo?: string): Promise<void>;
  ler(chave: string): Promise<Buffer>;
  listar(prefixo?: string): Promise<string[]>;
}

export interface BaseDados {
  consultar<T = unknown>(sql: string, parametros?: unknown[]): Promise<T[]>;
  fechar(): Promise<void>;
}

export interface Fila {
  enviar(mensagem: string): Promise<void>;
  /** Recebe e confirma até `maximo` mensagens. */
  receber(maximo?: number): Promise<string[]>;
  fechar(): Promise<void>;
}

/** S3 e MinIO falam a mesma API: um só adaptador com @aws-sdk/client-s3 (forcePathStyle para MinIO). */
export function criarArmazenamento(env?: NodeJS.ProcessEnv): Armazenamento {
  return naoImplementado('criarArmazenamento');
}

export function criarBaseDados(env?: NodeJS.ProcessEnv): BaseDados {
  return naoImplementado('criarBaseDados');
}

/** SQS (@aws-sdk/client-sqs). A migração da fila fica como slide. */
export function criarFila(env?: NodeJS.ProcessEnv): Fila {
  return naoImplementado('criarFila');
}
