// desfazer(pedidoId): aplica o inverso guardado na auditoria (criar_regra), volta a ler,
// regista 'desfeito' e avisa no Telegram. Chamado pelo comando /desfazer <pedidoId> ou pelo painel.
import type { EventoAuditoria, Inverso, Regra } from '@mwbe/shared';
import { auditoria, estado, leaseweb, telegram } from '@mwbe/shared';
import { type Avisar, avisarSemFalhar, horaCurta } from './corrigir';

/** O inverso a aplicar: o do último 'feito' do pedido, se ainda não tiver sido desfeito depois. */
export function inversoPendente(eventos: EventoAuditoria[], pedidoId: string): Inverso | undefined {
  const doPedido = eventos.filter((e) => e.pedidoId === pedidoId);
  const iFeito = doPedido.findLastIndex((e) => e.tipo === 'feito' && e.inverso);
  if (iFeito < 0) return undefined;
  if (doPedido.slice(iFeito + 1).some((e) => e.tipo === 'desfeito')) return undefined;
  return doPedido[iFeito].inverso;
}

/** Regras temporárias do modo noite deste pedido (desde o último desfeito), para tirar ao desfazer. */
export function temporariasModoNoite(eventos: EventoAuditoria[], pedidoId: string): Regra[] {
  const doPedido = eventos.filter((e) => e.pedidoId === pedidoId);
  const desde = doPedido.findLastIndex((e) => e.tipo === 'desfeito') + 1;
  return doPedido
    .slice(desde)
    .filter((e) => e.tipo === 'modo-noite-permitir' && e.depois)
    .map((e) => e.depois as Regra);
}

/** `avisar`: o canal do dono (por omissão telegram.notificar), como em corrigir(). */
export async function desfazer(pedidoId: string, avisar: Avisar = (t) => telegram.notificar(t)): Promise<void> {
  const eventos = auditoria.ler();
  const inverso = inversoPendente(eventos, pedidoId);
  if (!inverso) throw new Error(`Nada para desfazer no pedido ${pedidoId}`);
  if (inverso.tipo !== 'criar_regra') throw new Error(`Inverso não suportado: ${inverso.tipo}`);

  // Primeiro repor a regra original; só depois tirar as temporárias do modo noite (ninguém fica sem acesso a meio).
  const criada = await leaseweb.criarRegra(inverso.securityGroupId, inverso.regra);
  const temporarias = temporariasModoNoite(eventos, pedidoId);
  const tiradas: string[] = [];
  for (const t of temporarias) {
    try {
      await leaseweb.removerRegra(inverso.securityGroupId, t.id);
      tiradas.push(t.id);
    } catch (erro) {
      console.warn('[defesa] não consegui tirar a regra temporária', t.id, erro instanceof Error ? erro.message : erro);
    }
  }
  auditoria.registar({
    hora: new Date().toISOString(),
    pedidoId,
    tipo: 'desfeito',
    quem: 'defesa',
    depois: temporarias.length ? { reposta: criada, temporariasTiradas: tiradas } : criada,
  });
  if (estado.obterPedido(pedidoId)) estado.mudarEstado(pedidoId, 'desfeito');
  await avisarSemFalhar(avisar, `Desfeito às ${horaCurta()}: a regra voltou (${criada.protocol} ${criada.startPort} de ${criada.source}).`);
}
