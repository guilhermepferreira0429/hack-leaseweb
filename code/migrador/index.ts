// Biblioteca do migrador. O ponto de entrada é cli.ts.
// Fluxo: analisar -> proporPlano -> testes antes -> migrarDados -> testes depois -> comparar.
// Cada passo escreve na auditoria (fase 'migrar') para aparecer no painel.
import type { Auditoria, Config } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';
import type { PlanoMigracao } from './analisar';
import type { RelatorioCopia } from './migrar-dados';
import type { Comparacao } from './verificar';

export * from './analisar';
export * from './migrar-dados';
export * from './verificar';

export interface ResultadoMigracao {
  plano: PlanoMigracao;
  copias: RelatorioCopia[];
  testes: Comparacao;
}

export function migrar(config: Config, auditoria: Auditoria, opcoes?: { soAnalisar?: boolean }): Promise<ResultadoMigracao> {
  return naoImplementado('migrar');
}
