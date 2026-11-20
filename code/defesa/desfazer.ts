// desfazer(pedidoId): aplica o inverso guardado na auditoria (criar_regra), volta a ler,
// regista 'desfeito' e avisa no Telegram. Chamado pelo comando /desfazer <pedidoId> ou pelo painel.
import { naoImplementado } from '@mwbe/shared';

export function desfazer(pedidoId: string): Promise<void> {
  return naoImplementado('desfazer');
}
