// Biblioteca do atacante. O ponto de entrada é cli.ts.
import type { Auditoria, Config } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export * from './alvos';
export * from './reconhecimento';

/**
 * Corre o reconhecimento a todos os alvos da allowlist e escreve cada achado
 * na auditoria (tipo 'achado', fase 'atacar'), onde a defesa os vai buscar.
 */
export function campanha(config: Config, auditoria: Auditoria): Promise<number> {
  return naoImplementado('campanha');
}
