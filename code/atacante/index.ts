// Passo de "ataque" da demo: adivinhação de palavra-passe SSH, limitada, contra UM alvo da allowlist.
// Só às VMs que nós controlamos e com a organização avisada antes (docs/research/detection-and-response.md).
// Nada destrutivo: para na primeira entrada, não tenta sudo, não escreve nada no alvo e não persiste.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'ssh2';
import { bus, carregarEnv } from '@mwbe/shared';
import type { Achado, Mensagem } from '@mwbe/shared';
import { carregarAllowlist, garantirPermitido } from './alvos';
import { executarExtras } from './extras';
import { paraAchado, verificarPortas } from './reconhecimento';
import type { PortaTestada } from './reconhecimento';
import { varrerSegredos } from './segredos';
import type { SegredoEncontrado } from './segredos';

export * from './alvos';
export * from './reconhecimento';
export * from './segredos';
export * from './http';
export * from './credenciais';
export * from './extras';
export * from './ssh-auth';

/** Máximo de tentativas por ronda de SSH, mesmo que a wordlist cresça. Depois passa às outras ferramentas. */
export const MAX_TENTATIVAS = 5;
/** Pausa entre tentativas: a demo tem de ser legível e o auth.log não fica uma parede de linhas. */
export const PAUSA_ENTRE_TENTATIVAS_MS = 800;
/** Tempo máximo para estabelecer a sessão SSH. */
export const TIMEOUT_SSH_MS = 8_000;
/** Utilizador deixado na VM da demo (docs/research/detection-and-response.md). */
export const UTILIZADOR_DEMO = 'deploy';

export interface OpcoesForcaBruta {
  alvo: string;
  utilizador?: string;
  senhas: readonly string[];
  allowlist: ReadonlySet<string>;
  maxTentativas?: number;
  pausaMs?: number;
  timeoutMs?: number;
  /** Relato de cada tentativa. Por defeito, console.log. */
  log?: (texto: string) => void;
}

export interface ResultadoForcaBruta {
  alvo: string;
  utilizador: string;
  tentativas: number;
  sucesso: boolean;
  senha?: string;
}

function pausa(ms: number): Promise<void> {
  return ms > 0 ? esperar(ms) : Promise.resolve();
}

/** Lê a wordlist: uma senha por linha, `#` é comentário, linhas vazias e repetidas saem. */
export function lerWordlist(texto: string): string[] {
  const senhas = texto
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0 && !linha.startsWith('#'));
  return [...new Set(senhas)];
}

function falhaDeAutenticacao(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  const nivel = (erro as { level?: unknown }).level;
  return nivel === 'client-authentication' || /authentication methods failed/i.test(erro.message);
}

/**
 * Uma tentativa = uma ligação SSH nova, como faria um atacante real.
 * Devolve o cliente já autenticado, ou undefined se a senha estiver errada.
 * Erros de rede são lançados: a demo pára em vez de insistir contra uma máquina que não responde.
 */
function tentarSenha(
  alvo: string,
  utilizador: string,
  senha: string,
  timeoutMs: number,
): Promise<Client | undefined> {
  return new Promise((concluir, falhar) => {
    const cliente = new Client();
    // Depois da primeira falha a ligação é fechada; este listener evita um 'error' tardio sem tratamento.
    cliente.on('error', () => {});
    let terminado = false;
    const fim = (resultado: Client | undefined, erro?: unknown) => {
      if (terminado) return;
      terminado = true;
      // Numa tentativa falhada a ligação não serve para nada: fecha-se já, sem esperar pelo servidor.
      if (!resultado) cliente.end();
      if (erro) falhar(erro);
      else concluir(resultado);
    };
    cliente.once('ready', () => fim(cliente));
    cliente.once('error', (erro: Error) => {
      if (falhaDeAutenticacao(erro)) fim(undefined);
      else fim(undefined, erro);
    });
    cliente.once('close', () => fim(undefined, new Error(`ligação fechada por ${alvo}`)));
    cliente.connect({
      host: alvo,
      port: 22,
      username: utilizador,
      password: senha,
      readyTimeout: timeoutMs,
      // O alvo é um IP literal que nós controlamos e está na allowlist. A chave do servidor pode
      // mudar quando a VM de demo é reconstruída, por isso não se fixa aqui.
      hostVerifier: () => true,
    });
  });
}

/** Força bruta limitada: guarda antes de cada ligação, no máximo MAX_TENTATIVAS, para na primeira entrada. */
export async function executarForcaBruta(opcoes: OpcoesForcaBruta): Promise<ResultadoForcaBruta> {
  const alvo = opcoes.alvo.trim();
  const utilizador = opcoes.utilizador?.trim() || UTILIZADOR_DEMO;
  const maxTentativas = Math.max(0, Math.min(opcoes.maxTentativas ?? MAX_TENTATIVAS, MAX_TENTATIVAS));
  const senhas = [...new Set(opcoes.senhas.map((s) => s.trim()).filter(Boolean))].slice(0, maxTentativas);
  const log = opcoes.log ?? ((texto: string) => console.log('[atacante]', texto));

  if (senhas.length === 0) throw new Error('wordlist vazia: nada para tentar');
  if (maxTentativas === 0) throw new Error('máximo de tentativas é 0: nada para tentar');

  for (let i = 0; i < senhas.length; i++) {
    // A guarda repete-se antes de CADA ligação, não é uma verificação única no início do processo.
    garantirPermitido(alvo, opcoes.allowlist);
    const senha = senhas[i]!;
    log(`attempt ${i + 1}/${senhas.length} on ${alvo}, user '${utilizador}'`);

    const cliente = await tentarSenha(alvo, utilizador, senha, opcoes.timeoutMs ?? TIMEOUT_SSH_MS);
    if (cliente) {
      log(`got in on attempt ${i + 1}; session closed, nothing changed`);
      cliente.end();
      return { alvo, utilizador, tentativas: i + 1, sucesso: true, senha };
    }

    log('  failed');
    if (i < senhas.length - 1) await pausa(opcoes.pausaMs ?? PAUSA_ENTRE_TENTATIVAS_MS);
  }

  log(`wordlist exhausted, no entry on ${alvo}`);
  return { alvo, utilizador, tentativas: senhas.length, sucesso: false };
}

/** Lê a wordlist e o .env e corre a força bruta limitada. Usa a mesma guarda do executarForcaBruta. */
export async function forcaBrutaDemo(
  alvo: string,
  allowlist: ReadonlySet<string>,
  opcoes: { log?: (texto: string) => void } = {},
): Promise<ResultadoForcaBruta> {
  carregarEnv();
  const texto = await readFile(new URL('./wordlist.txt', import.meta.url), 'utf8');
  const lista = lerWordlist(texto);
  // A senha exata da demo pode vir do .env (git-ignored); a wordlist já traz a combinada.
  const senhaDemo = process.env.ATACANTE_SENHA_DEMO?.trim();
  const senhas = senhaDemo ? [senhaDemo, ...lista] : lista;
  return executarForcaBruta({
    alvo,
    utilizador: process.env.ATACANTE_SSH_UTILIZADOR,
    senhas,
    allowlist,
    log: opcoes.log,
  });
}

/** Entrada da CLI do passo de SSH. Devolve o código de saída (0 = entrou, 1 = não entrou). */
export async function mainForcaBruta(args: string[] = process.argv.slice(2)): Promise<number> {
  carregarEnv();
  const allowlist = carregarAllowlist(process.env.ALVOS_PERMITIDOS);
  if (allowlist.size === 0) {
    console.error('[atacante] ALVOS_PERMITIDOS está vazio: nenhum alvo permitido.');
    // TODO: os IPs reais das VMs da demo vão em ALVOS_PERMITIDOS no .env, nunca no repositório.
    return 1;
  }

  const alvoPedido = args.find((a) => !a.startsWith('--'));
  if (!alvoPedido && allowlist.size > 1) {
    console.error('[atacante] há vários IPs na allowlist: indica o alvo do passo SSH.');
    return 1;
  }
  const alvo = alvoPedido ?? [...allowlist][0]!;

  console.log(`[atacante] alvo ${alvo}, utilizador '${process.env.ATACANTE_SSH_UTILIZADOR || UTILIZADOR_DEMO}'`);
  console.log(
    `[atacante] no máximo ${MAX_TENTATIVAS} tentativas, ${PAUSA_ENTRE_TENTATIVAS_MS} ms entre cada uma.`,
  );

  const resultado = await forcaBrutaDemo(alvo, allowlist, {
    log: (texto) => console.log('[atacante]', texto),
  });
  return resultado.sucesso ? 0 : 1;
}

// ---------- /attack (ou /atacar): sequência completa, com relato no grupo ----------

export type EstadoAtaque = 'feito' | 'em-curso' | 'recusado' | 'falhou';

export interface ResultadoAtaque {
  estado: EstadoAtaque;
  alvo?: string;
}

export interface OpcoesAtaque {
  alvo?: string;
  log?: (texto: string) => void;
  /** Corre também os extras de nível B no fim. Por omissão: ATACANTE_EXTRAS=1. */
  extras?: boolean;
  /** Chamado depois de cada ronda, para a defesa reagir antes de o atacante tentar a seguinte. */
  aoRonda?: (ronda: RondaAtaque) => Promise<void> | void;
}

export type RondaAtaque = {
  nome: 'reconhecimento' | 'extras';
  achados: Achado[];
};

export interface DependenciasAtaque {
  bus: { enviar(m: Mensagem): void };
  allowlist: () => ReadonlySet<string>;
  reconhecer: (alvo: string, allowlist: ReadonlySet<string>) => Promise<PortaTestada[]>;
  forcaBruta: (
    alvo: string,
    allowlist: ReadonlySet<string>,
    log: (texto: string) => void,
  ) => Promise<ResultadoForcaBruta>;
  extras: (alvo: string, allowlist: ReadonlySet<string>) => Promise<Achado[]>;
  segredos: () => Promise<SegredoEncontrado[]>;
}

let ataqueEmCurso = false;

function depsAtaquePadrao(): DependenciasAtaque {
  return {
    bus,
    allowlist: () => {
      carregarEnv();
      return carregarAllowlist(process.env.ALVOS_PERMITIDOS);
    },
    reconhecer: (alvo, allowlist) => verificarPortas(alvo, allowlist),
    forcaBruta: (alvo, allowlist, log) => forcaBrutaDemo(alvo, allowlist, { log }),
    extras: (alvo, allowlist) => {
      const bucket = process.env.ATACANTE_BUCKET || process.env.ARMAZENAMENTO_BUCKET || '';
      const portaBucket = Number.parseInt(process.env.ATACANTE_BUCKET_PORTA ?? '9000', 10) || 9000;
      return executarExtras(alvo, allowlist, { bucket, portaBucket });
    },
    segredos: () => varrerSegredos(fileURLToPath(new URL('../../code/exemplo-app', import.meta.url))),
  };
}

/** Tira palavras-passe de um relato vindo da força bruta, por segurança. */
function semSegredo(texto: string): string {
  return texto.replace(/(?:senha|password)\s*[:=]?\s*'[^']*'/gi, 'password [hidden]');
}

/**
 * Sequência /attack (ou /atacar): reconhecimento -> SSH -> extras (opcional).
 * Relata cada passo pelo bus (agente atacante) e nunca publica palavras-passe/segredos.
 * A allowlist é a primeira barreira; um ataque de cada vez.
 */
export async function iniciarAtaque(
  opcoes: OpcoesAtaque = {},
  deps: DependenciasAtaque = depsAtaquePadrao(),
): Promise<ResultadoAtaque> {
  const log = opcoes.log ?? ((texto: string) => console.log('[atacante]', texto));
  const falar = (texto: string) => {
    log(texto);
    try {
      deps.bus.enviar({ de: 'atacante', para: 'todos', texto });
    } catch (erro) {
      log(`bus falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  };

  if (ataqueEmCurso) {
    falar('attack already running');
    return { estado: 'em-curso' };
  }

  let allowlist: ReadonlySet<string>;
  try {
    allowlist = deps.allowlist();
  } catch (erro) {
    falar(`allowlist invalid, attack refused: ${erro instanceof Error ? erro.message : String(erro)}`);
    return { estado: 'recusado' };
  }
  if (allowlist.size === 0) {
    falar('allowlist empty, attack refused');
    return { estado: 'recusado' };
  }

  const alvo = (opcoes.alvo ?? [...allowlist][0] ?? '').trim();
  if (!alvo) {
    falar('allowlist empty, attack refused');
    return { estado: 'recusado' };
  }
  try {
    garantirPermitido(alvo, allowlist);
  } catch {
    falar(`target refused (not in allowlist): ${alvo}`);
    return { estado: 'recusado', alvo };
  }

  ataqueEmCurso = true;
  try {
    // A defesa reage entre rondas; se ela falhar, o ataque continua na mesma.
    const avisarRonda = async (ronda: RondaAtaque): Promise<void> => {
      try {
        await opcoes.aoRonda?.(ronda);
      } catch (erro) {
        log(`defesa não reagiu à ronda ${ronda.nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    };

    falar(`⚔️ Attack started against ${alvo}`);

    const portas = await deps.reconhecer(alvo, allowlist);
    const abertas = portas.filter((p) => p.estado === 'aberta').map((p) => p.porta);
    falar(
      abertas.length > 0
        ? `👁️ Recon: ${abertas.length} open port(s): ${abertas.join(', ')}`
        : '👁️ Recon: no open ports',
    );
    await avisarRonda({ nome: 'reconhecimento', achados: portas.filter((p) => p.estado === 'aberta').map(paraAchado) });

    // Uma só linha no grupo para a força bruta; o detalhe por tentativa fica no log local (consola/painel),
    // para o grupo não encher de "attempt/failed". semSegredo garante que a palavra-passe nunca sai.
    falar('🔓 SSH: trying a short list of weak passwords…');
    const ssh = await deps.forcaBruta(alvo, allowlist, (texto) => log(semSegredo(texto)));
    falar(
      ssh.sucesso
        ? `✅ SSH: got in as ${ssh.utilizador} after ${ssh.tentativas} attempt(s)`
        : `❌ SSH: no entry after ${ssh.tentativas} attempt(s)`,
    );

    const comExtras = opcoes.extras ?? process.env.ATACANTE_EXTRAS === '1';
    if (comExtras) {
      const achados = await deps.extras(alvo, allowlist);
      const lista = achados.map((a) => `${a.servico ?? 'service'} ${a.porta}`).join(', ');
      falar(`🧪 Extras: ${achados.length} finding(s)${lista ? ` (${lista})` : ''}`);
      await avisarRonda({ nome: 'extras', achados });
      const segredos = await deps.segredos();
      falar(`🧪 Secrets in code: ${segredos.length} found`);
    }

    falar('✅ Attack finished');
    return { estado: 'feito', alvo };
  } catch (erro) {
    falar(`❌ Attack failed: ${erro instanceof Error ? erro.message : String(erro)}`);
    return { estado: 'falhou', alvo };
  } finally {
    ataqueEmCurso = false;
  }
}

// Só corre quando este ficheiro é o ponto de entrada; o pacote é importado pelo orquestrador.
const entrada = process.argv[1];
if (entrada && pathToFileURL(resolve(entrada)).href === import.meta.url) {
  mainForcaBruta()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((erro) => {
      console.error('[atacante]', erro instanceof Error ? erro.message : erro);
      process.exitCode = 1;
    });
}
