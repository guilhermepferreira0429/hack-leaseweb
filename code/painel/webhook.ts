// /webhook -> entrada única dos cliques humanos.
// GET: verificação do WhatsApp. POST: lê o corpo bruto, valida assinatura (WhatsApp) ou segredo (Telegram),
// confirma o remetente na lista de aprovadores e só então chama tratarResposta da defesa.
// Responde 200 depressa; o trabalho na Leaseweb corre a seguir.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { naoImplementado } from '@mwbe/shared';

/** Lê o corpo bruto (necessário para validar X-Hub-Signature-256). Limite de tamanho. */
export function lerCorpoBruto(req: IncomingMessage, limiteBytes?: number): Promise<Buffer> {
  return naoImplementado('lerCorpoBruto');
}

export async function tratarWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('tratarWebhook');
}
