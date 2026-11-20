// Estado em memória do processo único: pedidos pendentes e feitos. O painel lê daqui (/estado.json).
// A auditoria é o registo permanente; isto é só o estado vivo (perde-se ao reiniciar, de propósito).
import type { EstadoPedido, Pedido } from './tipos';

const pedidos = new Map<string, Pedido>();

/** Cópia, para ninguém alterar o estado por fora sem passar por aqui. */
const copia = (p: Pedido): Pedido => ({ ...p });

export function guardarPedido(pedido: Pedido): void {
  if (pedidos.has(pedido.id)) throw new Error(`Pedido ${pedido.id} já existe`);
  pedidos.set(pedido.id, copia(pedido));
}

export function obterPedido(id: string): Pedido | undefined {
  const p = pedidos.get(id);
  return p && copia(p);
}

export function mudarEstado(id: string, estado: EstadoPedido): Pedido {
  const p = pedidos.get(id);
  if (!p) throw new Error(`Pedido desconhecido: ${id}`);
  const novo = { ...p, estado };
  pedidos.set(id, novo);
  return copia(novo);
}

/** Por ordem de criação. */
export function listarPedidos(): Pedido[] {
  return [...pedidos.values()].map(copia);
}

/** Só para testes. */
export function limparEstado(): void {
  pedidos.clear();
}
