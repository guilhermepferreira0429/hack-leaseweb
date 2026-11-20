// Liga os botões "Desfazer" do relatório do incidente (Telegram, shared/relatorio.ts) ao desfazer() da defesa.
// O telegram.ts já só entrega cliques de aprovadores/dono (podeComandar). Aqui: um desfazer de cada vez por pedido,
// para dois cliques seguidos não tentarem repor a mesma regra duas vezes.
import type { Avisar } from './corrigir';
import { desfazer } from './desfazer';

export interface CanalDesfazer {
  aoDesfazer(cb: (pedidoId: string, quem: string) => void): void;
  notificar(texto: string): Promise<void>;
}

export function ligarDesfazer(canal: CanalDesfazer, fazer: (id: string, avisar: Avisar) => Promise<void> = desfazer): void {
  const emCurso = new Set<string>();
  canal.aoDesfazer((pedidoId, quem) => {
    if (emCurso.has(pedidoId)) return;
    emCurso.add(pedidoId);
    console.log(`[defesa] desfazer ${pedidoId} pedido por ${quem}`);
    fazer(pedidoId, (t) => canal.notificar(t))
      .catch(async (erro) => {
        const msg = erro instanceof Error ? erro.message : String(erro);
        console.warn('[defesa] desfazer falhou:', msg);
        await canal.notificar(`Could not undo ${pedidoId}: ${msg}`).catch(() => {});
      })
      .finally(() => emCurso.delete(pedidoId));
  });
}
