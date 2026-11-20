// tratar(achado): explica (LLM), monta o Pedido, guarda-o como pendente e pede aprovação no Telegram.
// Não altera nada na infraestrutura. A resposta do dono chega por telegram.aoResponder (no orquestrador).
import type { Achado, Pedido } from '@mwbe/shared';
import { auditoria, estado, explicar, telegram } from '@mwbe/shared';
import { acaoPara, montarPedido } from './explicar';

/** `pedirAprovacao` é o Telegram por omissão; o modo --consola do orquestrador passa o seu. */
export async function tratar(
  achado: Achado,
  pedirAprovacao: (agente: 'defesa', pedido: Pedido) => Promise<void> = telegram.pedirAprovacao,
): Promise<Pedido> {
  const acao = acaoPara(achado);
  if (!acao) throw new Error(`Finding ${achado.id} has no linked rule: nothing to close.`);
  const texto = await explicar(achado);
  const pedido = montarPedido(achado, texto, acao);
  estado.guardarPedido(pedido);
  auditoria.registar({
    hora: new Date().toISOString(),
    pedidoId: pedido.id,
    tipo: 'pedido',
    quem: 'defesa',
    // texto: a explicação da IA, para o ecrã /palco a mostrar mesmo quando o painel corre noutro processo.
    depois: { achado, titulo: pedido.titulo, texto: pedido.texto },
  });
  await pedirAprovacao('defesa', pedido);
  return pedido;
}
