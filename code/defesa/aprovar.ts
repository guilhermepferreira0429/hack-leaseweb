// tratar(achado): explica (LLM), monta o Pedido, guarda-o como pendente e pede aprovação no Telegram.
// Não altera nada na infraestrutura. A resposta do dono chega por telegram.aoResponder (no orquestrador).
import type { Achado, Pedido } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export function tratar(achado: Achado): Promise<Pedido> {
  return naoImplementado('tratar');
}
