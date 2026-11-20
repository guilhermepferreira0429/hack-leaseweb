// Allowlist de alvos. O atacante SÓ toca IPs listados em ALVOS_PERMITIDOS (env/.env).
// Regras: só IPs literais (sem hostnames, sem CIDR, sem intervalos); lista vazia = recusa tudo.
import type { Auditoria } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export class AlvoRecusadoError extends Error {
  constructor(readonly alvo: string) {
    super(`Alvo recusado (fora da allowlist): ${alvo}`);
    this.name = 'AlvoRecusadoError';
  }
}

/** Lê e valida a lista (cada entrada tem de ser um IPv4/IPv6 literal válido). */
export function carregarAllowlist(valorEnv: string | undefined): ReadonlySet<string> {
  return naoImplementado('carregarAllowlist');
}

/** Lança AlvoRecusadoError se o alvo não estiver na allowlist. Chamar antes de CADA ligação. */
export function garantirPermitido(alvo: string, allowlist: ReadonlySet<string>): void {
  naoImplementado('garantirPermitido');
}

/** Igual a garantirPermitido, mas regista a recusa na auditoria (para aparecer no painel). */
export function filtrarAlvos(
  pedidos: string[],
  allowlist: ReadonlySet<string>,
  auditoria: Auditoria,
): Promise<string[]> {
  return naoImplementado('filtrarAlvos');
}
