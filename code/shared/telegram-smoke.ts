// Teste de fumo do Telegram, para correr assim que houver token: npm run telegram:smoke
// Lê tudo de env/.env (ou .env na raiz). Não há segredos aqui e o token nunca é impresso.
// Testa TODOS os bots que tiverem token (os 4, com a equipa completa): getMe e uma fala no grupo por bot.
// Precisa de: TELEGRAM_TOKEN_* (os 4, de preferência), TELEGRAM_GRUPO_ID e um aprovador
// (TELEGRAM_APROVADORES ou TELEGRAM_DONO_ID). Ver docs/telegram.md.
//
// Passos (PASS/FAIL cada um):
//   config) os 4 bots têm token
//   a) long polling arranca em cada bot (getMe) e cada bot fala no grupo
//   b) envia um pedido com os botões do tipo de ação (Aprovar plano / Ignorar na migração)
//   c) um toque de um ID fora da lista é recusado (simulado) e o toque real do aprovador chega por callback_query
//   d) editMessageReplyMarkup tira os botões da mensagem carregada
//   e) envia um relatório de exemplo (montarRelatorio) ao grupo "Direção" com botão Desfazer
// Não mexe em auditoria.jsonl nem em infraestrutura.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Agente } from './bus';
import { montarRelatorio } from './relatorio';
import * as telegram from './telegram';
import type { EventoAuditoria, Pedido } from './tipos';

const ESPERA_TOQUE_MS = 120_000;
const ESPERA_DESFAZER_MS = 60_000;
const ID_CALLBACK_FALSO = 'smoke-falso';

for (const rel of ['../../env/.env', '../../.env']) {
  const f = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(f)) {
    process.loadEnvFile(f);
    console.log(`env: ${rel.replace('../../', '')}`);
    break;
  }
}

const lista = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CHAVES: [Agente, string][] = [
  ['defesa', 'TELEGRAM_TOKEN_DEFESA'],
  ['chefe', 'TELEGRAM_TOKEN_CHEFE'],
  ['migrador', 'TELEGRAM_TOKEN_MIGRADOR'],
  ['atacante', 'TELEGRAM_TOKEN_ATACANTE'],
];
const comToken = CHAVES.filter(([, k]) => process.env[k]?.trim()).map(([agente, chave]) => ({
  agente,
  chave,
  token: process.env[chave]!.trim(),
}));
const principal = comToken.find((b) => b.agente === 'defesa') ?? comToken[0];
const semToken = CHAVES.filter(([, k]) => !process.env[k]?.trim()).map(([a]) => a);
const grupoId = process.env.TELEGRAM_GRUPO_ID?.trim() ?? '';
const donoId = process.env.TELEGRAM_DONO_ID?.trim() ?? '';
const aprovadores = lista(process.env.TELEGRAM_APROVADORES).length ? lista(process.env.TELEGRAM_APROVADORES) : donoId ? [donoId] : [];

const emFalta = [
  ...(principal ? [] : ['TELEGRAM_TOKEN_* (nenhum)']),
  ...(grupoId ? [] : ['TELEGRAM_GRUPO_ID']),
  ...(aprovadores.length ? [] : ['TELEGRAM_APROVADORES ou TELEGRAM_DONO_ID']),
];
if (emFalta.length || !principal) {
  console.error(`FAIL  config: em falta ${emFalta.join(', ')}. Ver docs/telegram.md.`);
  process.exit(1);
}
const naoAprovador = [1, 2, 3].find((n) => !aprovadores.includes(String(n)))!;

// ---------- espião do fetch: regista cada chamada (só o nome do método, nunca o URL com o token) ----------

type Chamada = { metodo: string; bot?: Agente; ok: boolean; corpo: Record<string, unknown>; resultado?: unknown; erro?: string };
const chamadas: Chamada[] = [];
let injetarRecusa = true;
const fetchReal = globalThis.fetch;
const botDoToken = new Map(comToken.map((b) => [b.token, b.agente]));

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const token = url.match(/\/bot([^/]+)\//)?.[1];
  const bot = token ? botDoToken.get(token) : undefined;
  const metodo = url.match(/\/bot[^/]+\/(\w+)$/)?.[1] ?? '?';
  const corpo = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
  const responder = (dados: unknown) => new Response(JSON.stringify(dados), { headers: { 'Content-Type': 'application/json' } });

  // c) Toque simulado de um ID fora da lista: o 1.º getUpdates devolve-o logo, sem ir à rede.
  if (metodo === 'getUpdates' && injetarRecusa) {
    injetarRecusa = false;
    const falso = {
      update_id: 0,
      callback_query: { id: ID_CALLBACK_FALSO, from: { id: naoAprovador, first_name: 'intruso' }, data: 'aprovar:smoke-pedido' },
    };
    chamadas.push({ metodo: 'getUpdates(simulado)', ok: true, corpo });
    return responder({ ok: true, result: [falso] });
  }
  if (metodo === 'answerCallbackQuery' && corpo.callback_query_id === ID_CALLBACK_FALSO) {
    chamadas.push({ metodo, ok: true, corpo });
    return responder({ ok: true, result: true });
  }

  const r = await fetchReal(input, init);
  const dados = (await r.clone().json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  chamadas.push({ metodo, bot, ok: Boolean(dados.ok), corpo, resultado: dados.result, erro: dados.description });
  if (metodo === 'getUpdates' && Array.isArray(dados.result)) {
    for (const u of dados.result as { callback_query?: { from: { id: number }; data?: string } }[]) {
      if (u.callback_query) console.log(`      callback_query de ${u.callback_query.from.id}: ${u.callback_query.data}`);
    }
  }
  return r;
}) as typeof fetch;

// ---------- passos ----------

const resultados: [string, boolean, string][] = [];
function passo(nome: string, ok: boolean, nota = ''): void {
  resultados.push([nome, ok, nota]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${nota ? ` — ${nota}` : ''}`);
}
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function ate(cond: () => boolean, ms: number): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await esperar(250);
  }
  return cond();
}
const temBotao = (c: Chamada, prefixo: string) => JSON.stringify(c.corpo.reply_markup ?? '').includes(`"${prefixo}`);

async function main(): Promise<void> {
  console.log(`bots: ${comToken.map((b) => `${b.agente} (${b.chave})`).join(', ')}`);
  console.log(`grupo: ${grupoId}, aprovadores: ${aprovadores.join(', ')}, ID de teste fora da lista: ${naoAprovador}\n`);
  // TELEGRAM_API_BASE (opcional): só para ensaiar contra um servidor falso local. Por defeito https://api.telegram.org
  const apiBase = process.env.TELEGRAM_API_BASE?.trim() || undefined;
  telegram.configurarTelegram({
    tokens: Object.fromEntries(comToken.map((b) => [b.agente, b.token])),
    grupoId,
    donoId,
    aprovadores,
    pausaMs: 300,
    apiBase,
  });

  const pedidoId = `smoke-${Date.now().toString(36)}`;
  const toques: { pedidoId: string; decisao: string; quem: string }[] = [];
  telegram.aoResponder((id, decisao, quem) => {
    toques.push({ pedidoId: id, decisao, quem });
    console.log(`      aoResponder: ${decisao} em ${id} por ${quem}`);
  });
  const desfazeres: { pedidoId: string; quem: string }[] = [];
  telegram.aoDesfazer((id, quem) => {
    desfazeres.push({ pedidoId: id, quem });
    console.log(`      aoDesfazer: ${id} por ${quem} (só registado; nada é desfeito)`);
  });

  // config) e a): os 4 bots, um a um.
  passo(
    'config) os 4 bots têm token',
    semToken.length === 0,
    semToken.length ? `em falta: ${semToken.join(', ')}` : comToken.map((b) => b.agente).join(', '),
  );
  await ate(() => comToken.every((b) => chamadas.some((c) => c.metodo === 'getMe' && c.bot === b.agente)), 20_000);
  for (const b of comToken) {
    const me = chamadas.find((c) => c.metodo === 'getMe' && c.bot === b.agente);
    passo(
      `a) bot ${b.agente} arrancou (getMe)`,
      Boolean(me?.ok),
      me?.ok ? `@${(me.resultado as { username?: string }).username}` : me?.erro ?? 'sem resposta',
    );
  }
  // a) parte 2: cada bot tem de estar no grupo (sendMessage sai do bot certo).
  for (const b of comToken) {
    try {
      await telegram.falar(b.agente, `[Teste de fumo] ${b.agente} presente.`);
    } catch (e) {
      console.log(`      ${b.agente}: ${e instanceof Error ? e.message : e}`);
    }
    const m = chamadas.findLast((c) => c.metodo === 'sendMessage' && c.bot === b.agente);
    passo(
      `a) bot ${b.agente} fala no grupo`,
      Boolean(m?.ok && m && String(m.corpo.chat_id) === grupoId),
      m?.ok ? '' : `${m?.erro ?? 'sem sendMessage'} (o bot está no grupo?)`,
    );
  }

  // c) parte 1: recusa ao ID fora da lista (o update simulado já foi tratado pelo ciclo).
  await ate(() => chamadas.some((c) => c.metodo === 'answerCallbackQuery' && c.corpo.callback_query_id === ID_CALLBACK_FALSO), 5_000);
  const recusa = chamadas.find((c) => c.metodo === 'answerCallbackQuery' && c.corpo.callback_query_id === ID_CALLBACK_FALSO);
  const recusado = Boolean(recusa && /Sem permissão/.test(String(recusa.corpo.text))) && !toques.some((t) => t.quem === String(naoAprovador));
  passo(`c) ID ${naoAprovador} (fora da lista) recusado`, recusado && !telegram.podeAprovar(naoAprovador), recusa ? `resposta: "${String(recusa.corpo.text)}"` : 'sem answerCallbackQuery');

  // b)
  const pedido: Pedido = {
    id: pedidoId,
    titulo: '[Teste de fumo] Pedido de aprovação',
    texto: 'Mensagem de teste. Carrega em Aprovar plano ou em Ignorar: nada é executado.',
    acao: { tipo: 'migrar', passo: 's3' },
    estado: 'pendente',
  };
  let enviada: Chamada | undefined;
  try {
    await telegram.pedirAprovacao(principal.agente, pedido);
    enviada = chamadas.findLast((c) => c.metodo === 'sendMessage' && temBotao(c, `aprovar:${pedidoId}`));
  } catch (e) {
    console.log(`      ${e instanceof Error ? e.message : e}`);
  }
  passo('b) pedido com os botões do tipo de ação enviado', Boolean(enviada?.ok && enviada && temBotao(enviada, `ignorar:${pedidoId}`)));
  const mensagemId = (enviada?.resultado as { message_id?: number } | undefined)?.message_id;

  // a) parte 2: um getUpdates real respondeu (sem 409 de outro processo a fazer polling ao mesmo bot).
  console.log(`\n>>> Carrega em Aprovar plano ou em Ignorar no Telegram (${ESPERA_TOQUE_MS / 1000} s), com a conta de um aprovador.\n`);
  const tocou = enviada ? await ate(() => toques.some((t) => t.pedidoId === pedidoId), ESPERA_TOQUE_MS) : false;
  const conflito = chamadas.find((c) => c.metodo === 'getUpdates' && !c.ok);
  if (conflito) console.log(`      getUpdates: ${conflito.erro} (outro processo a usar este bot? webhook ativo?)`);

  // c) parte 2
  const toque = toques.find((t) => t.pedidoId === pedidoId);
  passo('c) callback_query do aprovador recebido', tocou && Boolean(toque && aprovadores.includes(toque.quem)), toque ? `${toque.decisao} por ${toque.quem}` : 'ninguém carregou a tempo');

  // d)
  const edicao = chamadas.find((c) => c.metodo === 'editMessageReplyMarkup' && c.corpo.message_id === mensagemId);
  passo('d) botões tirados (editMessageReplyMarkup)', Boolean(edicao?.ok), edicao ? (edicao.ok ? '' : edicao.erro ?? '') : 'não chamado');

  // e)
  let relatorio: Chamada | undefined;
  let pedidosRelatorio: string[] = [];
  try {
    await telegram.falar(principal.agente, '[Teste de fumo] O relatório a seguir é um exemplo, não um incidente real.');
    const r = montarRelatorio('smoke-achado', eventosExemplo());
    pedidosRelatorio = r.botoes.map((b) => b.pedidoId);
    await telegram.enviarComDesfazer(principal.agente, r.texto, r.botoes);
    relatorio = chamadas.findLast((c) => c.metodo === 'sendMessage' && temBotao(c, 'desfazer:'));
  } catch (e) {
    console.log(`      ${e instanceof Error ? e.message : e}`);
  }
  passo('e) relatório de exemplo com Desfazer no grupo', Boolean(relatorio?.ok && relatorio && String(relatorio.corpo.chat_id) === grupoId));
  const relatorioId = (relatorio?.resultado as { message_id?: number } | undefined)?.message_id;

  // f) toque num botão Desfazer do relatório (ao vivo). O polling fica vivo toda a janela, para TODOS os
  // botões responderem; sem isto, o teste saía ao primeiro toque e os restantes ficavam mortos.
  if (relatorio?.ok) {
    const alvo = Math.max(1, pedidosRelatorio.length);
    console.log(`\n>>> Carrega nos ${pedidosRelatorio.length} botões Desfazer do relatório (${ESPERA_DESFAZER_MS / 1000} s), com a conta de um aprovador.\n`);
    // Espera todos os botões, ou o tempo acabar; o que vier primeiro.
    await ate(() => desfazeres.length >= alvo, ESPERA_DESFAZER_MS);
    const validos = desfazeres.filter((x) => aprovadores.includes(x.quem));
    // O transport tira só o botão carregado (editMessageReplyMarkup à mensagem do relatório), uma vez por toque.
    const remocoes = chamadas.filter((c) => c.metodo === 'editMessageReplyMarkup' && c.corpo.message_id === relatorioId).length;
    passo(
      'f) botões Desfazer recebidos e removidos',
      validos.length > 0 && remocoes >= validos.length,
      validos.length ? `${validos.length}/${pedidosRelatorio.length} carregados: ${validos.map((x) => x.pedidoId).join(', ')}` : 'ninguém carregou a tempo',
    );
  } else {
    passo('f) botão Desfazer recebido e removido', false, 'relatório não foi enviado (passo e falhou)');
  }

  for (const b of comToken) {
    const falhou = chamadas.find((c) => c.metodo === 'getUpdates' && c.bot === b.agente && !c.ok);
    passo(`a) getUpdates de ${b.agente} sem erro`, !falhou, falhou?.erro ?? '');
  }

  const falhas = resultados.filter(([, ok]) => !ok).length;
  console.log(`\n${falhas ? `FAIL  ${falhas} de ${resultados.length} passos` : `PASS  ${resultados.length} de ${resultados.length} passos`}`);
  telegram.pararPolling();
  globalThis.fetch = fetchReal;
  process.exit(falhas ? 1 : 0);
}

/** Incidente de exemplo (só em memória). */
function eventosExemplo(): EventoAuditoria[] {
  const achado = {
    id: 'smoke-achado', tipo: 'compromisso', origem: 'auth-log', alvo: 'vitima-exemplo', porta: 22, servico: 'ssh',
    severidade: 'critica', detalhe: 'exemplo', ipOrigem: '203.0.113.7', utilizador: 'deploy', tentativas: 37,
  };
  const t0 = Date.now() - 60_000;
  const t = (s: number) => new Date(t0 + s * 1000).toISOString();
  const evs: unknown[] = [];
  const passos: [string, Record<string, unknown>, string][] = [
    ['smoke-p1', { tipo: 'bloquear_ip', host: 'vitima-exemplo', ip: '203.0.113.7' }, 'desbloquear_ip'],
    ['smoke-p2', { tipo: 'terminar_sessoes', host: 'vitima-exemplo', utilizador: 'deploy' }, 'irreversivel'],
    ['smoke-p3', { tipo: 'bloquear_utilizador', host: 'vitima-exemplo', utilizador: 'deploy' }, 'desbloquear_utilizador'],
  ];
  passos.forEach(([id, acao, inverso], i) => {
    evs.push({ hora: t(i), pedidoId: id, tipo: 'pedido', quem: 'defesa', depois: { achado } });
    evs.push({ hora: t(i + 3), pedidoId: id, tipo: String(acao.tipo), acao, depois: {}, inverso: { tipo: inverso } });
  });
  return evs as EventoAuditoria[];
}

main().catch((e: unknown) => {
  console.error('FAIL ', e instanceof Error ? e.message : e);
  process.exit(1);
});
