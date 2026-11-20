// Botão Desfazer: lê o inverso guardado na auditoria e repõe a regra.
// O clique no botão é a aprovação humana desta ação.
import type { Acao, Auditoria, ClienteLeaseweb, RespostaHumana } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

/**
 * 1. procura a ação na auditoria e o seu inverso
 * 2. recusa se a ação não estiver 'confirmada' ou já tiver sido desfeita
 * 3. autoriza de novo a regra (repor-regra), volta a ler para confirmar
 * 4. regista 'desfeito' com o novo estado
 */
export function desfazer(
  acaoId: string,
  resposta: RespostaHumana,
  leaseweb: ClienteLeaseweb,
  auditoria: Auditoria,
): Promise<Acao> {
  return naoImplementado('desfazer');
}
