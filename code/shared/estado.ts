// Estado em memória do processo único: pedidos pendentes e feitos. O painel lê daqui (/estado.json).
// A auditoria é o registo permanente; isto é só o estado vivo.
import type { EstadoPedido, Pedido } from './tipos';
import { naoImplementado } from './stub';

export function guardarPedido(pedido: Pedido): void {
  naoImplementado('guardarPedido');
}

export function obterPedido(id: string): Pedido | undefined {
  return naoImplementado('obterPedido');
}

export function mudarEstado(id: string, estado: EstadoPedido): Pedido {
  return naoImplementado('mudarEstado');
}

export function listarPedidos(): Pedido[] {
  return naoImplementado('listarPedidos');
}
