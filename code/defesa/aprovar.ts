// tratar(achado): explica (LLM), monta o Pedido, guarda-o como pendente e pede aprovação no Telegram.
// Não altera nada na infraestrutura. A resposta do dono chega por telegram.aoResponder (no orquestrador).
import type { Achado, Pedido } from '@mwbe/shared';
import { auditoria, estado, explicar, telegram } from '@mwbe/shared';
import { acaoPara, montarPedido } from './explicar';

export async function tratar(achado: Achado): Promise<Pedido> {
  const acao = acaoPara(achado);
  if (!acao) throw new Error(`Achado ${achado.id} sem regra associada: não há nada a fechar.`);
  const texto = await explicar(achado);
  const pedido = montarPedido(achado, texto, acao);
  estado.guardarPedido(pedido);
  auditoria.registar({
    hora: new Date().toISOString(),
    pedidoId: pedido.id,
    tipo: 'pedido',
    quem: 'defesa',
    depois: { achado, titulo: pedido.titulo },
  });
  await telegram.pedirAprovacao('defesa', pedido);
  return pedido;
}
