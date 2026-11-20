// corrigir(pedido): executa a Acao de um pedido APROVADO, verifica e audita.
// remover_regra:
//   1. recusa se pedido.estado !== 'aprovado' ou se o tipo não estiver em TIPOS_ACAO
//   2. leaseweb.removerRegra (lê, remove, volta a ler)
//   3. auditoria.registar com antes, depois e inverso { tipo: 'criar_regra', securityGroupId, regra sem id }
//   4. estado 'feito' e telegram.notificar("Fechado e confirmado às HH:MM")
// migrar: delega no migrador (passo s3).
import type { Inverso, Pedido } from '@mwbe/shared';
import { TIPOS_ACAO, auditoria, estado, leaseweb, securityGroupsGeridos, telegram } from '@mwbe/shared';

/** Calcula o inverso ANTES de aplicar. */
export function inversoDe(pedido: Pedido): Inverso | undefined {
  const a = pedido.acao;
  if (a.tipo !== 'remover_regra') return undefined;
  const { id: _id, ...semId } = a.regra;
  return { tipo: 'criar_regra', securityGroupId: a.securityGroupId, regra: semId };
}

export const horaCurta = (d = new Date()) =>
  d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });

export type Avisar = (texto: string) => Promise<void>;

/** Avisar o dono nunca pode partir o ciclo: a porta já está fechada e auditada. */
export async function avisarSemFalhar(avisar: Avisar, texto: string): Promise<void> {
  try {
    await avisar(texto);
  } catch (erro) {
    console.warn('[defesa] aviso no Telegram falhou:', erro instanceof Error ? erro.message : erro);
  }
}

/**
 * `avisar`: o canal do dono (por omissão telegram.notificar). O orquestrador passa o da consola no plano B,
 * para o "Fechado e confirmado ... /desfazer <id>" aparecer também em --consola.
 */
export async function corrigir(pedido: Pedido, avisar: Avisar = (t) => telegram.notificar(t)): Promise<void> {
  if (pedido.estado !== 'aprovado') throw new Error(`Pedido ${pedido.id} não está aprovado (estado: ${pedido.estado})`);
  if (!(TIPOS_ACAO as readonly string[]).includes(pedido.acao.tipo)) throw new Error(`Ação fora da lista: ${pedido.acao.tipo}`);

  const acao = pedido.acao;
  if (acao.tipo === 'migrar') {
    // O migrador é do Guilherme; o orquestrador chama-o diretamente. Aqui não se mexe em nada.
    throw new Error('Ação migrar: tratada pelo orquestrador (migrador), não pela defesa');
  }

  const geridos = securityGroupsGeridos();
  if (!geridos.includes(acao.securityGroupId)) {
    throw new Error(`Security group ${acao.securityGroupId} não está em LSW_SG_GERIDOS: a defesa não lhe mexe`);
  }

  const inverso = inversoDe(pedido);
  // O inverso fica no disco ANTES de se mexer na infraestrutura: se algo cair a meio, o Desfazer sabe o que repor.
  auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'a-aplicar', antes: acao.regra, inverso });

  let antes;
  try {
    ({ antes } = await leaseweb.removerRegra(acao.securityGroupId, acao.regra.id));
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'falhou', depois: msg });
    await avisarSemFalhar(avisar, `Não consegui fechar "${pedido.titulo}": ${msg}`);
    throw erro;
  }

  const depois = await leaseweb.listarRegras(acao.securityGroupId);
  auditoria.registar({ hora: new Date().toISOString(), pedidoId: pedido.id, tipo: 'feito', antes, depois, inverso });
  if (estado.obterPedido(pedido.id)) estado.mudarEstado(pedido.id, 'feito');
  await avisarSemFalhar(avisar, `Fechado e confirmado às ${horaCurta()}: ${pedido.titulo}. Para voltar atrás: /desfazer ${pedido.id}`);
}
