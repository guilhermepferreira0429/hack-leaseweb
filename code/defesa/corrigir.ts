// corrigir(pedido): executa a Acao de um pedido APROVADO, verifica e audita.
// remover_regra:
//   1. recusa se pedido.estado !== 'aprovado' ou se o tipo não estiver em TIPOS_ACAO
//   2. leaseweb.removerRegra (lê, remove, volta a ler)
//   3. auditoria.registar com antes, depois e inverso { tipo: 'criar_regra', securityGroupId, regra sem id }
//   4. estado 'feito' e telegram.notificar("Fechado e confirmado às HH:MM")
// migrar: delega no migrador (passo s3).
import type { Inverso, Pedido } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/** Calcula o inverso ANTES de aplicar. */
export function inversoDe(pedido: Pedido): Inverso | undefined {
  return naoImplementado('inversoDe');
}

export function corrigir(pedido: Pedido): Promise<void> {
  return naoImplementado('corrigir');
}
