// GET / -> HTML simples com a linha do tempo (migrar, atacar, aprovar, fechar).
// Atualização: meta refresh ou SSE a partir de Auditoria.seguir().
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Fase } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export const FASES: Fase[] = ['migrar', 'atacar', 'aprovar', 'fechar'];

/** Agrupa os eventos por fase, por ordem cronológica. */
export function agruparPorFase(eventos: EventoAuditoria[]): Record<Fase, EventoAuditoria[]> {
  return naoImplementado('agruparPorFase');
}

/** Gera o HTML (sem frameworks, texto escapado). */
export function renderizar(grupos: Record<Fase, EventoAuditoria[]>): string {
  return naoImplementado('renderizar');
}

export async function paginaLinhaTempo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('paginaLinhaTempo');
}
