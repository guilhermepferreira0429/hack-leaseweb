// Lê a app de exemplo e identifica os serviços AWS usados; propõe a alternativa aberta.
import { naoImplementado } from '@mwbe/shared';

export type ServicoAws = 's3' | 'rds-postgres' | 'sqs';
export type AlternativaAberta = 'minio' | 'postgres' | 'rabbitmq' | 'nats';

/** Mapeamento fixo. A ordem de execução segue docs/plano.md: S3, depois Postgres, depois SQS. */
export const ALTERNATIVAS: Record<ServicoAws, AlternativaAberta[]> = {
  s3: ['minio'],
  'rds-postgres': ['postgres'],
  sqs: ['rabbitmq', 'nats'],
};

export interface UsoDetetado {
  servico: ServicoAws;
  /** Onde foi encontrado (ficheiro:linha ou variável de ambiente). */
  evidencia: string[];
  /** Recursos concretos: buckets, tabelas, filas. */
  recursos: string[];
}

export interface ItemPlano {
  origem: ServicoAws;
  destino: AlternativaAberta;
  recursos: string[];
  /** Variáveis de ambiente que a app tem de mudar para apontar para o destino. */
  novasVariaveis: Record<string, string>;
}

export interface PlanoMigracao {
  app: string;
  itens: ItemPlano[];
  criadoEm: string;
}

/** Procura imports do SDK AWS e variáveis de ambiente na pasta da app. */
export function analisarApp(pastaApp: string): Promise<UsoDetetado[]> {
  return naoImplementado('analisarApp');
}

/** Converte os usos detetados num plano (escolhe a primeira alternativa, ou a pedida). */
export function proporPlano(usos: UsoDetetado[], preferencias?: Partial<Record<ServicoAws, AlternativaAberta>>): PlanoMigracao {
  return naoImplementado('proporPlano');
}
