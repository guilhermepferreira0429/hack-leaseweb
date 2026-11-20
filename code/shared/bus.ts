// Bus interno: a conversa entre agentes. Não passa pelo Telegram (os bots não leem outros bots).
// enviar() entrega internamente e publica no grupo pelo bot de `de`.
import { EventEmitter } from 'node:events';
import * as telegram from './telegram';
import type { Pedido } from './tipos';

export type Agente = 'chefe' | 'migrador' | 'atacante' | 'defesa';

export type Mensagem = { de: Agente; para: Agente | 'dono' | 'todos'; texto: string; pedido?: Pedido };

const emissor = new EventEmitter();
/** Últimas mensagens, para a página de estado. */
export const historico: (Mensagem & { hora: string })[] = [];

export function enviar(m: Mensagem): void {
  historico.push({ ...m, hora: new Date().toISOString() });
  if (historico.length > 200) historico.shift();
  console.log(`[${m.de} -> ${m.para}] ${m.texto}`);
  if (m.para === 'todos') {
    for (const a of ['chefe', 'migrador', 'atacante', 'defesa'] as Agente[]) if (a !== m.de) emissor.emit(a, m);
  } else if (m.para !== 'dono') {
    emissor.emit(m.para, m);
  }
  if (telegram.configurado()) {
    telegram.falar(m.de, m.texto).catch((e: unknown) => console.warn('[bus] telegram:', e instanceof Error ? e.message : e));
  }
}

export function aoReceber(a: Agente, cb: (m: Mensagem) => void): void {
  emissor.on(a, cb);
}
