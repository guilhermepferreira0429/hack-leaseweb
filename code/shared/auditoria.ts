// Auditoria append-only em JSONL. É também o "estado" partilhado entre processos:
// o atacante escreve achados, a defesa lê-os, o painel desenha a linha do tempo.
import type { Acao, EventoAuditoria } from './tipos';
import { naoImplementado } from './stub';

export type NovoEvento = Omit<EventoAuditoria, 'id' | 'ts'>;

export class Auditoria {
  constructor(private readonly caminho: string) {}

  /** Acrescenta uma linha (id e ts gerados aqui). Nunca reescreve linhas anteriores. */
  registar(evento: NovoEvento): Promise<EventoAuditoria> {
    return naoImplementado('Auditoria.registar');
  }

  /** Lê todos os eventos por ordem. Linhas corrompidas são ignoradas e reportadas. */
  ler(): Promise<EventoAuditoria[]> {
    return naoImplementado('Auditoria.ler');
  }

  /** Estado mais recente de uma ação (reconstruído a partir dos eventos). */
  obterAcao(acaoId: string): Promise<Acao | undefined> {
    return naoImplementado('Auditoria.obterAcao');
  }

  /** Notifica a cada nova linha (o painel usa isto para atualizar a linha do tempo). */
  seguir(aoReceber: (evento: EventoAuditoria) => void): () => void {
    return naoImplementado('Auditoria.seguir');
  }
}
