// Configuração do migrador a partir do .env da raiz. Não usa shared/config (carregarConfig) para não
// depender dele; lê só o que o migrador precisa. Nunca há chaves no código nem nos logs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAIZ_REPO = fileURLToPath(new URL('../../', import.meta.url));
const CAMINHO_ENV = fileURLToPath(new URL('../../.env', import.meta.url));

export interface Lado {
  nome: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  regiao: string;
}

export interface AmbienteMigrador {
  bucket: string;
  /** A "AWS" (LocalStack). */
  origem: Lado;
  /** A Leaseweb (MinIO). */
  destino: Lado;
}

let envCarregado = false;

/** Carrega o .env da raiz uma vez. As variáveis já definidas no processo ganham. */
export function carregarEnv(): void {
  if (envCarregado) return;
  envCarregado = true;
  if (existsSync(CAMINHO_ENV)) process.loadEnvFile(CAMINHO_ENV);
}

export function lerAmbienteMigrador(env: NodeJS.ProcessEnv = process.env): AmbienteMigrador {
  carregarEnv();
  const v = (nome: string): string | undefined => env[nome]?.trim() || undefined;
  const regiao = v('AWS_REGION') ?? 'us-east-1';
  const minioAccess = v('MINIO_ACCESS_KEY');
  const minioSecret = v('MINIO_SECRET_KEY');
  if (!minioAccess || !minioSecret) throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY are not set in .env');
  return {
    bucket: v('ARMAZENAMENTO_BUCKET') ?? 'faturas',
    origem: {
      nome: 'LocalStack',
      endpoint: v('LOCALSTACK_ENDPOINT') ?? 'http://127.0.0.1:4566',
      // O LocalStack aceita quaisquer credenciais; "test" é a convenção dele, não é um segredo.
      accessKey: 'test',
      secretKey: 'test',
      regiao,
    },
    destino: {
      nome: 'MinIO',
      endpoint: v('MINIO_ENDPOINT') ?? 'http://127.0.0.1:9000',
      accessKey: minioAccess,
      secretKey: minioSecret,
      regiao,
    },
  };
}

/** Ligações ao Postgres de origem (o "RDS") e de destino (Leaseweb). */
export function lerPostgres(env: NodeJS.ProcessEnv = process.env): { origem: string; destino: string } {
  carregarEnv();
  const v = (nome: string): string | undefined => {
    const valor = env[nome]?.trim();
    return valor && !valor.includes('<senha>') ? valor : undefined;
  };
  const origem = v('DATABASE_URL');
  const destino = v('DATABASE_URL_DESTINO');
  if (!origem) throw new Error('DATABASE_URL is not set in .env');
  if (!destino) throw new Error('DATABASE_URL_DESTINO is not set in .env (target Postgres at Leaseweb)');
  return { origem, destino };
}

/** host:porta de um URL de ligação, para mensagens de erro (sem utilizador nem senha). */
export function semCredenciais(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(URL inválido)';
  }
}

/** Variáveis que apontam a exemplo-app para um dos lados (o resto vem do .env). */
export function envDaApp(lado: Lado, bucket: string): Record<string, string> {
  return {
    ARMAZENAMENTO_ENDPOINT: lado.endpoint,
    ARMAZENAMENTO_BUCKET: bucket,
    ARMAZENAMENTO_ACCESS_KEY: lado.accessKey,
    ARMAZENAMENTO_SECRET_KEY: lado.secretKey,
  };
}
