// desfazer(pedidoId): aplica o inverso guardado na auditoria (criar_regra), volta a ler,
// regista 'desfeito' e avisa no Telegram. Chamado pelo comando /desfazer <pedidoId> ou pelo painel.
import type { EventoAuditoria, Inverso } from '@mwbe/shared';
import { auditoria, estado, leaseweb, telegram } from '@mwbe/shared';
import { horaCurta } from './corrigir';

/** O inverso a aplicar: o do último 'feito' do pedido, se ainda não tiver sido desfeito depois. */
export function inversoPendente(eventos: EventoAuditoria[], pedidoId: string): Inverso | undefined {
  const doPedido = eventos.filter((e) => e.pedidoId === pedidoId);
  const iFeito = doPedido.findLastIndex((e) => e.tipo === 'feito' && e.inverso);
  if (iFeito < 0) return undefined;
  if (doPedido.slice(iFeito + 1).some((e) => e.tipo === 'desfeito')) return undefined;
  return doPedido[iFeito].inverso;
}

export async function desfazer(pedidoId: string): Promise<void> {
  const inverso = inversoPendente(auditoria.ler(), pedidoId);
  if (!inverso) throw new Error(`Nada para desfazer no pedido ${pedidoId}`);
  if (inverso.tipo !== 'criar_regra') throw new Error(`Inverso não suportado: ${inverso.tipo}`);

  const criada = await leaseweb.criarRegra(inverso.securityGroupId, inverso.regra);
  auditoria.registar({ hora: new Date().toISOString(), pedidoId, tipo: 'desfeito', depois: criada });
  if (estado.obterPedido(pedidoId)) estado.mudarEstado(pedidoId, 'desfeito');
  try {
    await telegram.notificar(`Desfeito às ${horaCurta()}: a regra voltou (${criada.protocol} ${criada.startPort} de ${criada.source}).`);
  } catch (erro) {
    console.warn('[defesa] aviso no Telegram falhou:', erro instanceof Error ? erro.message : erro);
  }
}
