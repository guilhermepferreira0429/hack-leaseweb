// Telegram é o palco: um bot por agente, todos no grupo "Direção". Long polling (getUpdates), sem webhook.
// Ver docs/telegram.md e docs/agentes-telegram.md.
// Botões: callback_data = "aprovar:<pedidoId>" | "ignorar:<pedidoId>".
// Só aceita botões e ordens de TELEGRAM_DONO_ID. Comandos: /estado, /desfazer <pedidoId>.
// Os bots não recebem mensagens de outros bots: a conversa entre agentes passa por shared/bus.ts.
import type { Agente } from './bus';
import type { Decisao, Pedido } from './tipos';
import { naoImplementado } from './stub';

/** Variável de ambiente com o token de cada bot. */
export const TOKEN_POR_AGENTE: Record<Agente, string> = {
  chefe: 'TELEGRAM_TOKEN_CHEFE',
  migrador: 'TELEGRAM_TOKEN_MIGRADOR',
  atacante: 'TELEGRAM_TOKEN_ATACANTE',
  defesa: 'TELEGRAM_TOKEN_DEFESA',
};

/** Publica no grupo com o bot desse agente (com 1 a 2 s entre falas, para se ler bem). */
export function falar(agente: Agente, texto: string): Promise<void> {
  return naoImplementado('telegram.falar');
}

/** Mensagem com título, texto e botões Aprovar / Ignorar, enviada pelo bot do agente. */
export function pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void> {
  return naoImplementado('telegram.pedirAprovacao');
}

/** Regista o callback dos botões e arranca o long polling. Responde a answerCallbackQuery e edita a mensagem. */
export function aoResponder(cb: (pedidoId: string, decisao: Decisao, quem: string) => void): void {
  naoImplementado('telegram.aoResponder');
}

/** Mensagens do dono: em privado com um bot (agente) ou no grupo com menção; null se não for para nenhum. */
export function aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void {
  naoImplementado('telegram.aoMensagemDoDono');
}

/** Mensagem simples no grupo (pelo bot do chefe). */
export function notificar(texto: string): Promise<void> {
  return naoImplementado('telegram.notificar');
}

export function codificarBotao(decisao: Decisao, pedidoId: string): string {
  return `${decisao}:${pedidoId}`;
}
