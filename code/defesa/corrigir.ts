// Aplica uma ação aprovada: remove SÓ a regra em causa, volta a ler para confirmar,
// e guarda o inverso na auditoria. Só executa tipos de TIPOS_ACAO.
import type { Achado, Acao, Auditoria, ClienteLeaseweb, Explicacao, Regra, TipoAcao } from '@mwbe/shared';
import { TIPOS_ACAO, naoImplementado } from '@mwbe/shared';

/** Guarda: rejeita qualquer tipo que não esteja na lista fechada. */
export function tipoPermitido(tipo: string): tipo is TipoAcao {
  return (TIPOS_ACAO as readonly string[]).includes(tipo);
}

/**
 * Converte um achado numa ação proposta (estado 'proposta').
 * Determinístico, sem IA. Devolve undefined se o achado não tiver regra associada.
 * O inverso (repor-regra com a mesma especificação) é calculado aqui.
 */
export function proporAcao(achado: Achado, explicacao?: Explicacao): Acao | undefined {
  return naoImplementado('proporAcao');
}

export interface ResultadoCorrecao {
  acao: Acao;
  confirmada: boolean;
  /** Regras lidas depois da alteração, como prova. */
  regrasDepois: Regra[];
}

/**
 * Executa uma ação JÁ aprovada por um humano.
 * 1. confirma estado 'aprovada' e tipo permitido
 * 2. regista o inverso na auditoria ANTES de mexer
 * 3. revoga a regra (202, assíncrono)
 * 4. volta a ler as regras até a regra desaparecer (com timeout)
 * 5. regista 'aplicado' e 'confirmado' (ou 'falhou')
 */
export function aplicarAcao(
  acao: Acao,
  leaseweb: ClienteLeaseweb,
  auditoria: Auditoria,
): Promise<ResultadoCorrecao> {
  return naoImplementado('aplicarAcao');
}

/** Espera até a regra deixar de aparecer em firewallRules (ou estado DELETING terminar). */
export function esperarRegraRemovida(
  leaseweb: ClienteLeaseweb,
  securityGroupId: string,
  regraId: string,
  timeoutMs?: number,
): Promise<Regra[]> {
  return naoImplementado('esperarRegraRemovida');
}
