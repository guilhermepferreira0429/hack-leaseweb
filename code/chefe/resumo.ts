// Chefe: coordena e resume. Fala no fim de cada fase e faz a pergunta final ao dono.
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Resumo curto e com números reais (ex.: "1 falha encontrada e fechada em 40 segundos"). Sem IA. */
export function resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string {
  return naoImplementado('resumir');
}

/** Resposta ao /estado: pendentes e feitos. */
export function estadoAtual(pedidos: Pedido[]): string {
  return naoImplementado('estadoAtual');
}
