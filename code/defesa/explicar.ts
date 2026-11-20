// Monta o Pedido a partir do achado. O texto vem do LLM (shared/llm.ts, com texto fixo de recurso);
// a ação é decidida aqui, de forma determinística, a partir da lista fechada de Acao.
import { randomUUID } from 'node:crypto';
import type { Achado, Acao, Pedido } from '@mwbe/shared';

/** Id curto (8 hex): cabe no callback_data do Telegram e escreve-se à mão em /desfazer <id>. */
export function novoIdPedido(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Achado com regra e security group -> remover_regra. Sem isso -> undefined (só se notifica). */
export function acaoPara(achado: Achado): Acao | undefined {
  if (!achado.regra || !achado.securityGroupId) return undefined;
  return { tipo: 'remover_regra', securityGroupId: achado.securityGroupId, regra: achado.regra };
}

/** Título curto para a mensagem, ex.: "PostgreSQL aberto a toda a internet". */
export function tituloPara(achado: Achado): string {
  const servico = achado.servico ?? `Porta ${achado.porta}`;
  switch (achado.tipo) {
    case 'porta-exposta':
      return `${servico} aberto a toda a internet`;
    case 'servico-exposto':
      return `${servico} visível de fora (${achado.alvo})`;
    case 'credenciais-por-defeito':
      return `${servico} com palavra-passe de fábrica`;
    case 'isco-tocado':
      return `Tentativa de entrada no isco (${achado.alvo})`;
  }
}

export function montarPedido(achado: Achado, texto: string, acao: Acao): Pedido {
  return { id: novoIdPedido(), titulo: tituloPara(achado), texto, acao, estado: 'pendente' };
}
