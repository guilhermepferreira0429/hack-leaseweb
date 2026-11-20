// Auditoria append-only: uma linha JSON por evento em auditoria.jsonl (raiz do repo, no .gitignore).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventoAuditoria } from './tipos';

/** AUDITORIA_FICHEIRO permite apontar para outro ficheiro (testes). */
export function caminho(): string {
  return process.env.AUDITORIA_FICHEIRO || join(fileURLToPath(new URL('../../', import.meta.url)), 'auditoria.jsonl');
}

export function registar(e: EventoAuditoria): void {
  const linha = JSON.stringify({ ...e, hora: e.hora || new Date().toISOString() });
  // appendFileSync: escrita síncrona, o evento fica no disco antes de se mexer na infraestrutura.
  appendFileSync(caminho(), linha + '\n', 'utf8');
}

export function ler(): EventoAuditoria[] {
  if (!existsSync(caminho())) return [];
  const eventos: EventoAuditoria[] = [];
  for (const linha of readFileSync(caminho(), 'utf8').split('\n')) {
    if (!linha.trim()) continue;
    try {
      eventos.push(JSON.parse(linha) as EventoAuditoria);
    } catch {
      // Linha cortada (ex.: processo morto a meio): ignora-se, não se perde o resto.
    }
  }
  return eventos;
}
