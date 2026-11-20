// Pede aprovação humana por WhatsApp (Cloud API, botões interativos) ou Telegram (recurso).
// Os botões transportam apenas "decisao:acaoId". Quem responde tem de estar na lista de aprovadores.
import type { Acao, CanalAprovacao, Config, RespostaHumana } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export type Decisao = RespostaHumana['decisao'];

/** Formato do payload dos botões: "aprovar:<acaoId>" | "recusar:<acaoId>" | "desfazer:<acaoId>". */
export function codificarBotao(decisao: Decisao, acaoId: string): string {
  return `${decisao}:${acaoId}`;
}

export function descodificarBotao(payload: string): { decisao: Decisao; acaoId: string } | undefined {
  return naoImplementado('descodificarBotao');
}

export interface CanalMensagens {
  readonly nome: CanalAprovacao;
  /** Envia as 3 frases + botões Aprovar / Recusar. */
  pedirAprovacao(acao: Acao): Promise<void>;
  /** Depois de fechar: confirma ao humano e mostra o botão Desfazer. */
  avisarFechado(acao: Acao): Promise<void>;
  /** Mensagem simples (erros, confirmação do Desfazer). */
  avisar(texto: string): Promise<void>;
}

// ---------- WhatsApp Cloud API ----------
// POST https://graph.facebook.com/{versao}/{phoneNumberId}/messages
// type "interactive", interactive.type "button" (máx. 3 botões, título até 20 caracteres).

export class CanalWhatsApp implements CanalMensagens {
  readonly nome = 'whatsapp' as const;
  constructor(private readonly cfg: Config['whatsapp']) {}

  pedirAprovacao(acao: Acao): Promise<void> {
    return naoImplementado('CanalWhatsApp.pedirAprovacao');
  }
  avisarFechado(acao: Acao): Promise<void> {
    return naoImplementado('CanalWhatsApp.avisarFechado');
  }
  avisar(texto: string): Promise<void> {
    return naoImplementado('CanalWhatsApp.avisar');
  }
}

/** GET /webhook: verificação do Meta (hub.mode, hub.verify_token, hub.challenge). */
export function verificarSubscricaoWhatsApp(
  query: URLSearchParams,
  verifyToken: string,
): string | undefined {
  return naoImplementado('verificarSubscricaoWhatsApp');
}

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o app secret). */
export function assinaturaWhatsAppValida(corpoBruto: Buffer, assinatura: string, appSecret: string): boolean {
  return naoImplementado('assinaturaWhatsAppValida');
}

/** Extrai a resposta de botão do corpo do webhook do WhatsApp. */
export function lerRespostaWhatsApp(corpo: unknown): RespostaHumana | undefined {
  return naoImplementado('lerRespostaWhatsApp');
}

// ---------- Telegram (recurso) ----------
// POST https://api.telegram.org/bot{token}/sendMessage com reply_markup.inline_keyboard
// Resposta chega como callback_query; validar X-Telegram-Bot-Api-Secret-Token.

export class CanalTelegram implements CanalMensagens {
  readonly nome = 'telegram' as const;
  constructor(private readonly cfg: Config['telegram']) {}

  pedirAprovacao(acao: Acao): Promise<void> {
    return naoImplementado('CanalTelegram.pedirAprovacao');
  }
  avisarFechado(acao: Acao): Promise<void> {
    return naoImplementado('CanalTelegram.avisarFechado');
  }
  avisar(texto: string): Promise<void> {
    return naoImplementado('CanalTelegram.avisar');
  }
}

export function lerRespostaTelegram(corpo: unknown, segredoCabecalho: string | undefined, segredo: string): RespostaHumana | undefined {
  return naoImplementado('lerRespostaTelegram');
}

// ---------- comum ----------

/** Escolhe o canal configurado; se o WhatsApp falhar ao enviar, cai para o Telegram. */
export function criarCanal(cfg: Config): CanalMensagens {
  return naoImplementado('criarCanal');
}

/** Só aceita respostas de remetentes na lista de aprovadores. */
export function remetenteAutorizado(resposta: RespostaHumana, aprovadores: string[]): boolean {
  return naoImplementado('remetenteAutorizado');
}
