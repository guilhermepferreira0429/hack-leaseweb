// Telegram é o palco: um bot por agente, todos no grupo "Direção". Long polling (getUpdates), sem webhook.
// Ver docs/telegram.md e docs/agentes-telegram.md.
// Botões: callback_data = "aprovar:<pedidoId>" | "ignorar:<pedidoId>".
// Só aceita botões e ordens de TELEGRAM_DONO_ID. Comandos: /estado, /desfazer <pedidoId>.
// Os bots não recebem mensagens de outros bots: a conversa entre agentes passa por shared/bus.ts.
//
// Aprovação: sendMessage com reply_markup.inline_keyboard; a resposta chega como callback_query.
// Só os IDs de TELEGRAM_APROVADORES (por defeito o TELEGRAM_DONO_ID) podem carregar; os outros recebem
// "Sem permissão" e nada acontece. Os tokens nunca vão para logs.
import type { Agente } from './bus';
import type { Decisao, Pedido } from './tipos';

/** Variável de ambiente com o token de cada bot. */
export const TOKEN_POR_AGENTE: Record<Agente, string> = {
  chefe: 'TELEGRAM_TOKEN_CHEFE',
  migrador: 'TELEGRAM_TOKEN_MIGRADOR',
  atacante: 'TELEGRAM_TOKEN_ATACANTE',
  defesa: 'TELEGRAM_TOKEN_DEFESA',
};

const NOME_AGENTE: Record<Agente, string> = { chefe: 'Chefe', migrador: 'Migrador', atacante: 'Atacante', defesa: 'Defesa' };

interface ConfigTelegram {
  tokens: Partial<Record<Agente, string>>;
  grupoId: string;
  donoId: string;
  aprovadores: string[];
  /** Para testes (servidor falso). Por defeito https://api.telegram.org */
  apiBase?: string;
  /** Pausa entre falas, para se ler bem no grupo. */
  pausaMs?: number;
}

let config: ConfigTelegram | undefined;

/** Chamado pelo orquestrador com a Config. Sem isto lê-se de process.env. */
export function configurarTelegram(c: ConfigTelegram): void {
  config = { ...c };
}

function cfg(): ConfigTelegram {
  if (config) return config;
  const tokens: Partial<Record<Agente, string>> = {};
  for (const [a, chave] of Object.entries(TOKEN_POR_AGENTE) as [Agente, string][]) {
    const t = process.env[chave]?.trim();
    if (t) tokens[a] = t;
  }
  const donoId = process.env.TELEGRAM_DONO_ID?.trim() ?? '';
  const lista = (process.env.TELEGRAM_APROVADORES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  config = { tokens, grupoId: process.env.TELEGRAM_GRUPO_ID?.trim() ?? '', donoId, aprovadores: lista.length ? lista : donoId ? [donoId] : [] };
  return config;
}

/** Há pelo menos um bot configurado? */
export function configurado(): boolean {
  return Object.values(cfg().tokens).some(Boolean);
}

/** Token do agente; se esse bot não existir, o da defesa e depois qualquer outro (fala com prefixo). */
function tokenPara(agente: Agente): { token: string; proprio: boolean } | undefined {
  const t = cfg().tokens;
  if (t[agente]) return { token: t[agente]!, proprio: true };
  const outro = t.defesa ?? t.chefe ?? Object.values(t).find(Boolean);
  return outro ? { token: outro, proprio: false } : undefined;
}

function destino(): string {
  const { grupoId, donoId } = cfg();
  const d = grupoId || donoId;
  if (!d) throw new Error('TELEGRAM_GRUPO_ID ou TELEGRAM_DONO_ID em falta.');
  return d;
}

export class ErroTelegram extends Error {
  constructor(metodo: string, descricao: string) {
    super(`Telegram ${metodo}: ${descricao}`);
    this.name = 'ErroTelegram';
  }
}

async function chamar<T>(token: string, metodo: string, corpo: unknown, timeoutMs = 15_000): Promise<T> {
  const base = cfg().apiBase ?? 'https://api.telegram.org';
  let resposta: Response;
  try {
    resposta = await fetch(`${base}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (erro) {
    // A mensagem do fetch não inclui o URL (e portanto o token), mas não arriscamos.
    throw new ErroTelegram(metodo, erro instanceof Error ? erro.name : 'falha de rede');
  }
  const dados = (await resposta.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!dados.ok) throw new ErroTelegram(metodo, dados.description ?? `HTTP ${resposta.status}`);
  return dados.result as T;
}

// ---------- envio ----------

let fila: Promise<unknown> = Promise.resolve();
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mensagens enviadas em série, com pausa entre elas. */
function emSerie<T>(f: () => Promise<T>): Promise<T> {
  const r = fila.then(f, f);
  fila = r.then(
    () => esperar(cfg().pausaMs ?? 1_200),
    () => esperar(cfg().pausaMs ?? 1_200),
  );
  return r;
}

interface MensagemEnviada {
  message_id: number;
  chat: { id: number };
}

async function enviarTexto(agente: Agente, texto: string, teclado?: unknown): Promise<MensagemEnviada & { token: string }> {
  const t = tokenPara(agente);
  if (!t) throw new Error('Nenhum TELEGRAM_TOKEN_* configurado.');
  const corpo = {
    chat_id: destino(),
    text: (t.proprio ? texto : `[${NOME_AGENTE[agente]}] ${texto}`).slice(0, 4000),
    ...(teclado ? { reply_markup: teclado } : {}),
  };
  const m = await emSerie(() => chamar<MensagemEnviada>(t.token, 'sendMessage', corpo));
  return { ...m, token: t.token };
}

/** Publica no grupo com o bot desse agente (com 1 a 2 s entre falas, para se ler bem). */
export async function falar(agente: Agente, texto: string): Promise<void> {
  await enviarTexto(agente, texto);
}

/** Onde ficou a mensagem de cada pedido, para a editar com o resultado. */
const mensagensDosPedidos = new Map<string, { token: string; chatId: number; messageId: number; texto: string }>();

/** Mensagem com título, texto e botões Aprovar / Ignorar, enviada pelo bot do agente. */
export async function pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void> {
  // `risco` (opcional) só existe no Pedido do ramo da defesa; em main ainda não está em shared/tipos.ts.
  const risco = (pedido as Pedido & { risco?: string }).risco;
  const texto = [pedido.titulo, '', pedido.texto, '', `${risco ? `Risco: ${risco} · ` : ''}Pedido ${pedido.id}`].join('\n');
  const teclado = {
    inline_keyboard: [
      [
        { text: 'Aprovar', callback_data: codificarBotao('aprovar', pedido.id) },
        { text: 'Ignorar', callback_data: codificarBotao('ignorar', pedido.id) },
      ],
    ],
  };
  const m = await enviarTexto(agente, texto, teclado);
  mensagensDosPedidos.set(pedido.id, { token: m.token, chatId: m.chat.id, messageId: m.message_id, texto });
}

/** Edita a mensagem do pedido com o resultado (ex.: "Fechado e confirmado às 14:02") e tira os botões. */
export async function editarResultado(pedidoId: string, resultado: string): Promise<void> {
  const m = mensagensDosPedidos.get(pedidoId);
  if (!m) return;
  m.texto = `${m.texto}\n\n${resultado}`;
  await chamar(m.token, 'editMessageText', { chat_id: m.chatId, message_id: m.messageId, text: m.texto.slice(0, 4000) }).catch((e: unknown) =>
    console.warn('[telegram]', e instanceof Error ? e.message : e),
  );
}

/** Mensagem simples no grupo (pelo bot do chefe). */
export async function notificar(texto: string): Promise<void> {
  await falar('chefe', texto);
}

export function codificarBotao(decisao: Decisao, pedidoId: string): string {
  return `${decisao}:${pedidoId}`;
}

export function descodificarBotao(dados: string): { decisao: Decisao; pedidoId: string } | undefined {
  const m = dados.match(/^(aprovar|ignorar):([A-Za-z0-9._:-]{1,60})$/);
  return m ? { decisao: m[1] as Decisao, pedidoId: m[2]! } : undefined;
}

export function podeAprovar(id: string | number): boolean {
  return cfg().aprovadores.includes(String(id));
}

// ---------- receção (long polling) ----------

type CbResposta = (pedidoId: string, decisao: Decisao, quem: string) => void;
type CbMensagem = (agente: Agente | null, texto: string) => void;

const cbsResposta: CbResposta[] = [];
const cbsMensagem: CbMensagem[] = [];
let aPolling = false;
let controlador: AbortController | undefined;

interface Update {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
  message?: { message_id: number; from?: { id: number; is_bot?: boolean }; chat: { id: number; type: string }; text?: string };
}

/** Regista o callback dos botões e arranca o long polling. Responde a answerCallbackQuery e edita a mensagem. */
export function aoResponder(cb: (pedidoId: string, decisao: Decisao, quem: string) => void): void {
  cbsResposta.push(cb);
  iniciarPolling();
}

/** Mensagens do dono: em privado com um bot (agente) ou no grupo com menção; null se não for para nenhum. */
export function aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void {
  cbsMensagem.push(cb);
  iniciarPolling();
}

/** Para o long polling (fim da demo, testes). */
export function pararPolling(): void {
  aPolling = false;
  controlador?.abort();
}

function iniciarPolling(): void {
  if (aPolling || !configurado()) return;
  aPolling = true;
  controlador = new AbortController();
  // Um ciclo por bot distinto (cada bot só recebe os updates dele).
  const porToken = new Map<string, Agente>();
  for (const [a, t] of Object.entries(cfg().tokens) as [Agente, string][]) if (t && !porToken.has(t)) porToken.set(t, a);
  for (const [token, agente] of porToken) void ciclo(token, agente, controlador.signal);
}

async function ciclo(token: string, agente: Agente, sinal: AbortSignal): Promise<void> {
  let offset = 0;
  let nomeBot = '';
  try {
    nomeBot = (await chamar<{ username?: string }>(token, 'getMe', {})).username ?? '';
  } catch (e) {
    console.warn(`[telegram] getMe (${agente}):`, e instanceof Error ? e.message : e);
  }
  while (aPolling && !sinal.aborted) {
    try {
      const updates = await chamar<Update[]>(
        token,
        'getUpdates',
        { offset, timeout: 25, allowed_updates: ['callback_query', 'message'] },
        35_000,
      );
      for (const u of updates) {
        offset = u.update_id + 1;
        await tratarUpdate(token, agente, nomeBot, u).catch((e: unknown) => console.warn('[telegram]', e instanceof Error ? e.message : e));
      }
    } catch (e) {
      if (!aPolling) return;
      console.warn(`[telegram] getUpdates (${agente}):`, e instanceof Error ? e.message : e);
      await esperar(3_000);
    }
  }
}

async function tratarUpdate(token: string, agente: Agente, nomeBot: string, u: Update): Promise<void> {
  const q = u.callback_query;
  if (q) {
    const botao = q.data ? descodificarBotao(q.data) : undefined;
    if (!botao) {
      await chamar(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Botão desconhecido.' });
      return;
    }
    if (!podeAprovar(q.from.id)) {
      console.warn(`[telegram] botão de ${q.from.id} ignorado (não está em TELEGRAM_APROVADORES).`);
      await chamar(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Sem permissão para aprovar.', show_alert: true });
      return;
    }
    await chamar(token, 'answerCallbackQuery', { callback_query_id: q.id, text: botao.decisao === 'aprovar' ? 'Aprovado.' : 'Ignorado.' });
    const hora = new Date().toTimeString().slice(0, 5);
    // Tira os botões já: um segundo toque não faz nada.
    if (q.message) {
      const guardada = mensagensDosPedidos.get(botao.pedidoId);
      const texto = `${guardada?.texto ?? ''}\n\n${botao.decisao === 'aprovar' ? 'Aprovado' : 'Ignorado'} por ${q.from.first_name ?? q.from.id} às ${hora}.`.trim();
      if (guardada) guardada.texto = texto;
      await chamar(token, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: texto.slice(0, 4000) }).catch(() => {});
    }
    for (const cb of cbsResposta) cb(botao.pedidoId, botao.decisao, String(q.from.id));
    return;
  }

  const m = u.message;
  if (!m?.text || !m.from || m.from.is_bot) return;
  if (!podeAprovar(m.from.id) && String(m.from.id) !== cfg().donoId) return;
  let paraQuem: Agente | null = null;
  if (m.chat.type === 'private') paraQuem = agente;
  else if (nomeBot && m.text.includes(`@${nomeBot}`)) paraQuem = agente;
  // Comandos no grupo (/estado) chegam a todos os bots com privacy desligado: só um os trata.
  else if (agente !== principal()) return;
  const texto = nomeBot ? m.text.replaceAll(`@${nomeBot}`, '').trim() : m.text.trim();
  for (const cb of cbsMensagem) cb(paraQuem, texto);
}

/** O bot que trata as mensagens do grupo sem menção. */
function principal(): Agente {
  const t = cfg().tokens;
  return t.chefe ? 'chefe' : t.defesa ? 'defesa' : ((Object.keys(t) as Agente[]).find((a) => t[a]) ?? 'chefe');
}
