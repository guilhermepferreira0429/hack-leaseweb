// GET / (HTML simples, tabela se faltar tempo) e GET /estado.json.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export const FASES = ['migrar', 'atacar', 'aprovar', 'fechar'] as const;
export type Fase = (typeof FASES)[number];

/** Em que fase cai um evento da auditoria (pelo tipo do evento e da ação do pedido). */
export function faseDe(evento: EventoAuditoria): Fase {
  return naoImplementado('faseDe');
}

/** HTML sem frameworks, texto escapado, a ler /estado.json de 2 em 2 s. */
export function renderizar(pedidos: Pedido[], eventos: EventoAuditoria[]): string {
  return naoImplementado('renderizar');
}

export async function paginaLinhaTempo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('paginaLinhaTempo');
}

export async function estadoJson(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('estadoJson');
}
