// Copia dados da origem AWS (LocalStack + Postgres local) para a VM vítima na Leaseweb,
// com verificação por checksums em cada passo.
import type { Config } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';
import type { ItemPlano } from './analisar';

export interface ChecksumItem {
  chave: string;
  /** sha256 em hex. */
  origem: string;
  destino?: string;
}

export interface RelatorioCopia {
  item: ItemPlano;
  copiados: number;
  checksums: ChecksumItem[];
  /** true se todos os checksums de destino coincidem com os de origem. */
  integro: boolean;
  duracaoMs: number;
}

/** S3 (LocalStack) -> MinIO: lista objetos, copia, compara sha256 do conteúdo. Primeira prioridade. */
export function copiarS3ParaMinio(item: ItemPlano, config: Config): Promise<RelatorioCopia> {
  return naoImplementado('copiarS3ParaMinio');
}

/** Postgres (simula RDS) -> Postgres na Leaseweb: pg_dump/restore ou cópia por tabela; checksum por tabela (contagem + hash ordenado). */
export function copiarPostgres(item: ItemPlano, config: Config): Promise<RelatorioCopia> {
  return naoImplementado('copiarPostgres');
}

/** SQS (LocalStack) -> RabbitMQ: drena mensagens visíveis, publica, compara sha256 dos corpos. */
export function copiarSqsParaRabbit(item: ItemPlano, config: Config): Promise<RelatorioCopia> {
  return naoImplementado('copiarSqsParaRabbit');
}

/** Executa o plano item a item; pára no primeiro item não íntegro. */
export function migrarDados(itens: ItemPlano[], config: Config): Promise<RelatorioCopia[]> {
  return naoImplementado('migrarDados');
}
