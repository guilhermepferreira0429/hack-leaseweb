// Auditoria append-only: uma linha JSON por evento em auditoria.jsonl (raiz do repo, no .gitignore).
import type { EventoAuditoria } from './tipos';
import { naoImplementado } from './stub';

export function registar(e: EventoAuditoria): void {
  naoImplementado('auditoria.registar');
}

export function ler(): EventoAuditoria[] {
  return naoImplementado('auditoria.ler');
}
