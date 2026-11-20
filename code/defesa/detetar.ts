// Junta achados de duas fontes: o atacante (via auditoria) e a leitura dos security groups.
import type { Achado, Auditoria, ClienteLeaseweb, Regra } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Portas que nunca devem estar abertas ao mundo (0.0.0.0/0 ou ::/0). */
export const PORTAS_SENSIVEIS: Record<number, string> = {
  22: 'SSH',
  5432: 'Postgres',
  9000: 'MinIO API',
  9001: 'MinIO consola',
  5672: 'RabbitMQ AMQP',
  15672: 'RabbitMQ gestão',
  4222: 'NATS',
  8222: 'NATS monitorização',
  6379: 'Redis',
  11434: 'Ollama',
};

/** Regra aberta ao mundo que cobre uma porta sensível? Função pura, fácil de testar. */
export function regraExpoe(regra: Regra): { porta: number; servico: string } | undefined {
  return naoImplementado('regraExpoe');
}

/** Lê as regras dos security groups geridos e converte exposições em achados. */
export function detetarPorSecurityGroups(
  leaseweb: ClienteLeaseweb,
  securityGroupIds: string[],
): Promise<Achado[]> {
  return naoImplementado('detetarPorSecurityGroups');
}

/** Achados escritos pelo atacante (e pelo isco) na auditoria que ainda não foram tratados. */
export function achadosPendentes(auditoria: Auditoria): Promise<Achado[]> {
  return naoImplementado('achadosPendentes');
}

/**
 * Cruza achados do atacante com regras: um porto aberto observado de fora
 * é ligado à regra que o permite, para a defesa saber o que fechar.
 * Remove duplicados (mesmo IP, porta e regra).
 */
export function correlacionar(achados: Achado[], regras: Regra[]): Achado[] {
  return naoImplementado('correlacionar');
}
