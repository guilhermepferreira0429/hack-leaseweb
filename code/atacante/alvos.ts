// Allowlist de alvos. O atacante SÓ toca IPs listados em ALVOS_PERMITIDOS (.env).
// Só IPs literais (sem hostnames, sem CIDR, sem intervalos). Lista vazia = recusa tudo.
// Legal: scan ativo só às nossas VMs (Lei do Cibercrime, Lei 109/2009).
import { naoImplementado } from '@mwbe/shared';

export class AlvoRecusadoError extends Error {
  constructor(readonly alvo: string) {
    super(`Alvo recusado (fora da allowlist): ${alvo}`);
    this.name = 'AlvoRecusadoError';
  }
}

/** Lê ALVOS_PERMITIDOS e valida cada entrada (IPv4/IPv6 literal, via node:net isIP). */
export function carregarAllowlist(valorEnv: string | undefined): ReadonlySet<string> {
  return naoImplementado('carregarAllowlist');
}

/** Lança AlvoRecusadoError se o alvo não estiver na allowlist. Chamar antes de CADA scan. */
export function garantirPermitido(alvo: string, allowlist: ReadonlySet<string>): void {
  naoImplementado('garantirPermitido');
}

/** Separa permitidos de recusados (os recusados são auditados por quem chama, nunca contactados). */
export function filtrarAlvos(pedidos: string[], allowlist: ReadonlySet<string>): { permitidos: string[]; recusados: string[] } {
  return naoImplementado('filtrarAlvos');
}
