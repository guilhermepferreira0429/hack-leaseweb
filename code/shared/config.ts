// Leitura de configuração a partir de env/.env (nunca há chaves no código).
import { fileURLToPath } from 'node:url';
import { naoImplementado } from './stub';

export const RAIZ_REPO = fileURLToPath(new URL('../../', import.meta.url));
export const CAMINHO_ENV = fileURLToPath(new URL('../../env/.env', import.meta.url));

export interface Config {
  leaseweb: {
    apiBase: string;
    apiKey: string;
    /** Security groups que a defesa pode tocar. Qualquer outro é recusado. */
    securityGroupsGeridos: string[];
  };
  // O LLM não está aqui: lê-se com fornecedoresDoEnv() em llm.ts (LLM_* e LLM_*_2).
  whatsapp: {
    token: string;
    phoneNumberId: string;
    verifyToken: string;
    appSecret: string;
    destino: string;
    apiVersao: string;
  };
  telegram: { botToken: string; chatId: string; webhookSecret: string };
  aprovacao: { canal: 'whatsapp' | 'telegram'; aprovadores: string[] };
  atacante: { alvosPermitidos: string[]; timeoutMs: number };
  vms: { cerebro: string; vitima: string; isco: string };
  painel: { porta: number; urlPublica: string };
  auditoriaPath: string;
  origem: {
    awsEndpoint: string;
    awsRegiao: string;
    s3Bucket: string;
    sqsFila: string;
    postgresUrl: string;
  };
  destino: {
    minioEndpoint: string;
    minioAccessKey: string;
    minioSecretKey: string;
    postgresUrl: string;
    rabbitmqUrl: string;
  };
}

/** Carrega env/.env (se existir) para process.env e valida as chaves obrigatórias. */
export function carregarConfig(): Config {
  // TODO: process.loadEnvFile(CAMINHO_ENV) em try/catch; validar obrigatórias; listas separadas por vírgulas.
  return naoImplementado('carregarConfig');
}
