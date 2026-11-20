// Bus interno: a conversa entre agentes. Não passa pelo Telegram (os bots não leem outros bots).
// enviar() entrega internamente e publica no grupo pelo bot de `de`.
import type { Pedido } from './tipos';
import { naoImplementado } from './stub';

export type Agente = 'chefe' | 'migrador' | 'atacante' | 'defesa';

export type Mensagem = { de: Agente; para: Agente | 'dono' | 'todos'; texto: string; pedido?: Pedido };

export function enviar(m: Mensagem): void {
  naoImplementado('bus.enviar');
}

export function aoReceber(a: Agente, cb: (m: Mensagem) => void): void {
  naoImplementado('bus.aoReceber');
}
