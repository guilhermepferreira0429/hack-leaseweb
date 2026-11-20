// Configuração a partir de .env na raiz do repositório (ver env/.env.example). Nunca há chaves no código.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAIZ_REPO = fileURLToPath(new URL('../../', import.meta.url));
export const CAMINHO_ENV = fileURLToPath(new URL('../../.env', import.meta.url));
/** O README antigo mandava copiar para env/.env: aceita-se também, se o da raiz não existir. */
export const CAMINHO_ENV_ALTERNATIVO = fileURLToPath(new URL('../../env/.env', import.meta.url));

export interface Config {
  leaseweb: { apiBase: string; apiKey: string; securityGroupsGeridos: string[] };
  /** Um bot por agente (TELEGRAM_TOKEN_*), grupo "Direção" e o único utilizador cujas ordens contam. */
  telegram: { tokens: Record<'chefe' | 'migrador' | 'atacante' | 'defesa', string>; grupoId: string; donoId: string };
  /** IPs que o atacante pode tocar. Vazio = recusa tudo. */
  alvosPermitidos: string[];
  migrador: { localstackEndpoint: string; minioEndpoint: string; minioAccessKey: string; minioSecretKey: string };
  isco: { host: string; sshUser: string };
  porta: number;
  // O LLM lê-se diretamente de process.env em llm.ts (LLM_*, LLM_*_2, LLM_TIMEOUT_MS).
}

let envCarregado = false;

/** Carrega o .env para process.env uma vez (não sobrepõe variáveis já definidas na shell). */
export function carregarEnv(): void {
  if (envCarregado) return;
  envCarregado = true;
  const ficheiro = [CAMINHO_ENV, CAMINHO_ENV_ALTERNATIVO].find((f) => existsSync(f));
  if (ficheiro) process.loadEnvFile(ficheiro);
}

const lista = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * process.loadEnvFile(CAMINHO_ENV) se existir, valida as obrigatórias e devolve a Config.
 * `obrigatorias`: cada peça pede só o que usa (ex.: a defesa sozinha não precisa do MinIO).
 */
export function carregarConfig(obrigatorias: string[] = ['LSW_API_KEY']): Config {
  carregarEnv();
  const env = process.env;
  const emFalta = obrigatorias.filter((n) => !env[n]?.trim());
  if (emFalta.length) throw new Error(`Variáveis em falta no .env: ${emFalta.join(', ')}`);
  return {
    leaseweb: {
      apiBase: env.LSW_API_BASE || 'https://api.leaseweb.com/publicCloud/v1',
      apiKey: env.LSW_API_KEY ?? '',
      securityGroupsGeridos: lista(env.LSW_SG_GERIDOS),
    },
    telegram: {
      tokens: {
        chefe: env.TELEGRAM_TOKEN_CHEFE ?? '',
        migrador: env.TELEGRAM_TOKEN_MIGRADOR ?? '',
        atacante: env.TELEGRAM_TOKEN_ATACANTE ?? '',
        defesa: env.TELEGRAM_TOKEN_DEFESA ?? '',
      },
      grupoId: env.TELEGRAM_GRUPO_ID ?? '',
      donoId: env.TELEGRAM_DONO_ID ?? '',
    },
    alvosPermitidos: lista(env.ALVOS_PERMITIDOS),
    migrador: {
      localstackEndpoint: env.LOCALSTACK_ENDPOINT || 'http://127.0.0.1:4566',
      minioEndpoint: env.MINIO_ENDPOINT || 'http://127.0.0.1:9000',
      minioAccessKey: env.MINIO_ACCESS_KEY ?? '',
      minioSecretKey: env.MINIO_SECRET_KEY ?? '',
    },
    isco: { host: env.ISCO_HOST ?? '', sshUser: env.ISCO_SSH_USER ?? '' },
    porta: Number(env.PORT || 3000),
  };
}

/** Security groups em que a defesa pode mexer. Vazio = nenhum (falha fechado). */
export function securityGroupsGeridos(): string[] {
  carregarEnv();
  return lista(process.env.LSW_SG_GERIDOS);
}
