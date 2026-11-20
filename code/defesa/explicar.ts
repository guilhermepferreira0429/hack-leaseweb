// Monta o Pedido a partir do achado. O texto vem do LLM (shared/llm.ts, com texto fixo de recurso);
// a ação é decidida aqui, de forma determinística, a partir da lista fechada de Acao.
import { randomUUID } from 'node:crypto';
import type { Achado, Acao, Pedido } from '@mwbe/shared';

/** Id curto (8 hex): cabe no callback_data do Telegram e escreve-se à mão em /undo <id>. */
export function novoIdPedido(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Achado com regra e security group -> remover_regra. Sem isso -> undefined (só se notifica). */
export function acaoPara(achado: Achado): Acao | undefined {
  if (!achado.regra || !achado.securityGroupId) return undefined;
  return { tipo: 'remover_regra', securityGroupId: achado.securityGroupId, regra: achado.regra };
}

/** Título curto para a mensagem (em inglês: a demo é em inglês), ex.: "PostgreSQL open to the whole internet". */
export function tituloPara(achado: Achado): string {
  const servico = achado.servico ?? `Port ${achado.porta}`;
  switch (achado.tipo) {
    case 'porta-exposta':
      return `${servico} open to the whole internet`;
    case 'servico-exposto':
      return `${servico} visible from outside (${achado.alvo})`;
    case 'credenciais-por-defeito':
      return `${servico} with its factory default password`;
    case 'isco-tocado':
      return `Login attempt on the honeypot (${achado.alvo})`;
  }
}

export function montarPedido(achado: Achado, texto: string, acao: Acao): Pedido {
  return { id: novoIdPedido(), titulo: tituloPara(achado), texto, acao, estado: 'pendente' };
}
