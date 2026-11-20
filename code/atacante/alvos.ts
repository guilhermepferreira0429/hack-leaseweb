// Allowlist de alvos. O atacante SÓ toca IPs listados em ALVOS_PERMITIDOS (.env).
// Só IPs literais (sem hostnames, sem CIDR, sem intervalos). Lista vazia = recusa tudo.
// Legal: scan ativo só às nossas VMs (Lei do Cibercrime, Lei 109/2009).
import { isIP } from 'node:net';

export class AlvoRecusadoError extends Error {
  constructor(readonly alvo: string) {
    super(`Alvo recusado (fora da allowlist): ${alvo}`);
    this.name = 'AlvoRecusadoError';
  }
}

/** Entrada da allowlist que não é um IP literal. Falha fechado: não se continua com config duvidosa. */
export class AllowlistInvalidaError extends Error {
  constructor(readonly entrada: string) {
    super(`Entrada inválida em ALVOS_PERMITIDOS (não é IPv4/IPv6 literal): ${entrada}`);
    this.name = 'AllowlistInvalidaError';
  }
}

/**
 * Lê ALVOS_PERMITIDOS e valida cada entrada (IPv4/IPv6 literal, via node:net isIP).
 * Recebe o valor cru do env (ou config.alvosPermitidos já junto por vírgulas).
 * Lança AllowlistInvalidaError à primeira entrada que não seja um IP literal.
 */
export function carregarAllowlist(valorEnv: string | undefined): ReadonlySet<string> {
  const entradas = (valorEnv ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const entrada of entradas) {
    if (isIP(entrada) === 0) throw new AllowlistInvalidaError(entrada);
  }
  return new Set(entradas);
}

/** Lança AlvoRecusadoError se o alvo não estiver na allowlist. Chamar antes de CADA ação. */
export function garantirPermitido(alvo: string, allowlist: ReadonlySet<string>): void {
  if (!allowlist.has(alvo)) throw new AlvoRecusadoError(alvo);
}

/** Separa permitidos de recusados (os recusados são auditados por quem chama, nunca contactados). */
export function filtrarAlvos(
  pedidos: string[],
  allowlist: ReadonlySet<string>,
): { permitidos: string[]; recusados: string[] } {
  const permitidos: string[] = [];
  const recusados: string[] = [];
  for (const alvo of pedidos) {
    (allowlist.has(alvo) ? permitidos : recusados).push(alvo);
  }
  return { permitidos, recusados };
}
