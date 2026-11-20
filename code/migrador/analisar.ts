// Lê a app de exemplo, encontra os serviços AWS usados e escreve o plano em texto.
import { naoImplementado } from '@mwbe/shared';

export type ServicoAws = 's3' | 'postgres' | 'fila';

/** Alternativa aberta proposta para cada serviço. Só o S3 é migrado hoje; o resto é slide. */
export const ALTERNATIVA: Record<ServicoAws, string> = {
  s3: 'MinIO',
  postgres: 'PostgreSQL',
  fila: 'NATS',
};

/** Procura imports do SDK AWS (@aws-sdk/client-s3, client-sqs) e do pg na pasta da app. */
export function analisar(dirApp: string): Promise<{ servicos: ServicoAws[]; plano: string }> {
  return naoImplementado('analisar');
}
