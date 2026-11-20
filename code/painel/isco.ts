// GET /isco: quantas tentativas de entrada a VM isco recebeu desde que foi ligada, e de quantos IPs.
// Lê /var/log/auth.log por SSH (ISCO_HOST, ISCO_SSH_USER, só chave). Ver docs/demo.md.
// Só números medidos; nada inventado.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { naoImplementado } from '@mwbe/shared';

export interface ContagemIsco {
  tentativas: number;
  ipsDistintos: number;
  desde: string;
  lidoEm: string;
}

/** ssh (execFile, sem shell) + contagem das linhas de falha de autenticação. Cache de 30 s. */
export function contarTentativas(): Promise<ContagemIsco> {
  return naoImplementado('contarTentativas');
}

export async function paginaIsco(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('paginaIsco');
}
