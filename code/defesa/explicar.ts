// Monta o Pedido a partir do achado. O texto vem do LLM (shared/llm.ts, com texto fixo de recurso);
// a ação é decidida aqui, de forma determinística, a partir da lista fechada de Acao.
import type { Achado, Acao, Pedido } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Achado com regra -> remover_regra. Sem regra -> undefined (só se notifica, não há nada a fechar). */
export function acaoPara(achado: Achado): Acao | undefined {
  return naoImplementado('acaoPara');
}

/** Título curto para a mensagem, ex.: "PostgreSQL aberto a toda a internet". */
export function tituloPara(achado: Achado): string {
  return naoImplementado('tituloPara');
}

export function montarPedido(achado: Achado, texto: string, acao: Acao): Pedido {
  return naoImplementado('montarPedido');
}
