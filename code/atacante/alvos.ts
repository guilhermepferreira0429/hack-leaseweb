// Allowlist de alvos. O atacante SÓ toca IPs listados em ALVOS_PERMITIDOS (.env).
// Só IPs literais (sem hostnames, sem CIDR, sem intervalos). Lista vazia = recusa tudo.
// Legal: scan ativo só às nossas VMs (Lei do Cibercrime, Lei 109/2009).
import { isIP } from 'node:net';

export class AlvoRecusadoError extends Error {
  constructor(readonly alvo: string) {
    super(`Target refused (not in allowlist): ${alvo}`);
    this.name = 'AlvoRecusadoError';
  }
}

/** Entrada da allowlist que não é um IP literal. Falha fechado: com config duvidosa não se continua. */
export class AllowlistInvalidaError extends Error {
  constructor(readonly entrada: string) {
    super(`Entrada inválida em ALVOS_PERMITIDOS (não é IPv4/IPv6 literal): ${entrada}`);
    this.name = 'AllowlistInvalidaError';
  }
}

/**
 * Lê ALVOS_PERMITIDOS (lista separada por vírgulas) e valida cada entrada com node:net isIP.
 * Uma entrada inválida faz falhar a lista inteira: um erro de escrita não pode alargar a allowlist.
 * Lista vazia (ou em falta) devolve um conjunto vazio, que recusa todos os alvos.
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
  if (!allowlist.has(alvo.trim())) throw new AlvoRecusadoError(alvo);
}

/** Separa permitidos de recusados (os recusados são auditados por quem chama, nunca contactados). */
export function filtrarAlvos(
  pedidos: string[],
  allowlist: ReadonlySet<string>,
): { permitidos: string[]; recusados: string[] } {
  const permitidos: string[] = [];
  const recusados: string[] = [];
  for (const pedido of pedidos) {
    const alvo = pedido.trim();
    (allowlist.has(alvo) ? permitidos : recusados).push(alvo);
  }
  return { permitidos, recusados };
}
