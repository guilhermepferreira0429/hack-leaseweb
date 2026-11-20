// Configuração a partir de .env na raiz do repositório (ver env/.env.example). Nunca há chaves no código.
import { fileURLToPath } from 'node:url';
import { naoImplementado } from './stub';

export const RAIZ_REPO = fileURLToPath(new URL('../../', import.meta.url));
export const CAMINHO_ENV = fileURLToPath(new URL('../../.env', import.meta.url));

export interface Config {
  leaseweb: { apiBase: string; apiKey: string };
  /** Um bot por agente (TELEGRAM_TOKEN_*), grupo "Direção" e o único utilizador cujas ordens contam. */
  telegram: { tokens: Record<'chefe' | 'migrador' | 'atacante' | 'defesa', string>; grupoId: string; donoId: string };
  /** IPs que o atacante pode tocar. Vazio = recusa tudo. */
  alvosPermitidos: string[];
  migrador: { localstackEndpoint: string; minioEndpoint: string; minioAccessKey: string; minioSecretKey: string };
  isco: { host: string; sshUser: string };
  porta: number;
  // O LLM lê-se diretamente de process.env em llm.ts (LLM_*, LLM_*_2, LLM_TIMEOUT_MS).
}

/** process.loadEnvFile(CAMINHO_ENV) se existir, valida as obrigatórias e devolve a Config. */
export function carregarConfig(): Config {
  return naoImplementado('carregarConfig');
}
