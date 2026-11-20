// detetar(): regras com source 0.0.0.0/0 ou ::/0 nos security groups da conta (origem 'api').
// Os achados do atacante chegam pelo orquestrador e juntam-se aqui com correlacionar().
import type { Achado, Regra } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Severidade alta (docs/arquitetura.md). Qualquer outra porta aberta a toda a internet: média. */
export const PORTAS_SENSIVEIS: Record<number, string> = {
  22: 'SSH',
  23: 'Telnet',
  445: 'SMB',
  1433: 'SQL Server',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5984: 'CouchDB',
  6379: 'Redis',
  9200: 'Elasticsearch',
  27017: 'MongoDB',
};

export const ORIGENS_MUNDO = ['0.0.0.0/0', '::/0'] as const;

/** Função pura: a regra está aberta ao mundo? Se sim, devolve o achado (tipo 'porta-exposta'). */
export function avaliarRegra(sg: string, regra: Regra): Achado | undefined {
  return naoImplementado('avaliarRegra');
}

export function detetar(): Promise<Achado[]> {
  return naoImplementado('detetar');
}

/** Liga os achados do atacante (porta aberta vista de fora) à regra que a permite e remove duplicados. */
export function correlacionar(daApi: Achado[], doAtacante: Achado[]): Achado[] {
  return naoImplementado('correlacionar');
}
