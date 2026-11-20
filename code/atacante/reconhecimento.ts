// Reconhecimento leve e não destrutivo: uma ligação TCP curta às portas da demo num alvo da allowlist.
// Não há exploração, escrita nem força bruta. Visto de fora, uma porta filtrada e uma fechada
// parecem iguais (timeout): por isso só se reporta "aberta" ou "fechada".
import { Socket } from 'node:net';
import type { Achado } from '@mwbe/shared';
import { carregarEnv } from '@mwbe/shared';
import { carregarAllowlist, garantirPermitido } from './alvos';

/** Portas que a demo observa: SSH, HTTP, HTTPS e o PostgreSQL que ficou exposto por engano. */
export const PORTAS_ALVO = [22, 80, 443, 5432] as const;

/** Tempo máximo por porta. Uma porta filtrada esgota isto; as restantes respondem de imediato. */
export const TIMEOUT_PORTA_MS = 2_000;

export type EstadoPorta = 'aberta' | 'fechada';

export interface PortaTestada {
  alvo: string;
  porta: number;
  estado: EstadoPorta;
}

/** Nome e gravidade das portas que interessam à demo (docs/arquitetura.md). */
const SERVICOS: Record<number, { nome: string; severidade: Achado['severidade'] }> = {
  22: { nome: 'SSH', severidade: 'alta' },
  80: { nome: 'HTTP', severidade: 'media' },
  443: { nome: 'HTTPS', severidade: 'media' },
  5432: { nome: 'PostgreSQL', severidade: 'alta' },
};

/** Allowlist a partir do .env. O orquestrador e a CLI também carregam o .env; isto cobre quem chama direto. */
function allowlistDoAmbiente(): ReadonlySet<string> {
  carregarEnv();
  return carregarAllowlist(process.env.ALVOS_PERMITIDOS);
}

/** Uma ligação TCP, curta, sem enviar nada. Erro ou timeout contam como "fechada". */
function testarPorta(alvo: string, porta: number, timeoutMs: number): Promise<boolean> {
  return new Promise((concluir) => {
    const socket = new Socket();
    let terminado = false;
    const fim = (aberta: boolean) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      concluir(aberta);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => fim(true));
    socket.once('timeout', () => fim(false));
    socket.once('error', () => fim(false));
    socket.connect({ host: alvo, port: porta });
  });
}

/**
 * Verifica as PORTAS_ALVO de um alvo. A allowlist é conferida antes de cada ligação:
 * um alvo fora dela lança AlvoRecusadoError e nada é contactado.
 */
export async function verificarPortas(
  alvo: string,
  allowlist: ReadonlySet<string> = allowlistDoAmbiente(),
  portas: readonly number[] = PORTAS_ALVO,
): Promise<PortaTestada[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);
  return Promise.all(
    portas.map(async (porta) => {
      // A guarda repete-se antes de cada ligação: não é uma verificação única no início do processo.
      garantirPermitido(endereco, allowlist);
      const aberta = await testarPorta(endereco, porta, TIMEOUT_PORTA_MS);
      return { alvo: endereco, porta, estado: aberta ? 'aberta' : 'fechada' };
    }),
  );
}

/** Porta aberta -> Achado tipo 'servico-exposto', origem 'atacante'. */
export function paraAchado(porta: PortaTestada): Achado {
  const servico = SERVICOS[porta.porta];
  return {
    id: `atacante-${porta.alvo}-${porta.porta}`,
    tipo: 'servico-exposto',
    origem: 'atacante',
    alvo: porta.alvo,
    porta: porta.porta,
    servico: servico?.nome ?? null,
    severidade: servico?.severidade ?? 'media',
    detalhe: `TCP ${porta.porta} aceita ligação de fora em ${porta.alvo}`,
  };
}

/** Recusa IPs fora de ALVOS_PERMITIDOS; testa os restantes e devolve só as portas abertas. */
export async function reconhecer(
  alvos: string[],
  allowlist: ReadonlySet<string> = allowlistDoAmbiente(),
): Promise<Achado[]> {
  // Primeiro valida todos: se um alvo não estiver na lista, nada é contactado.
  for (const alvo of alvos) garantirPermitido(alvo, allowlist);

  const achados: Achado[] = [];
  for (const alvo of alvos) {
    for (const porta of await verificarPortas(alvo, allowlist)) {
      if (porta.estado === 'aberta') achados.push(paraAchado(porta));
    }
  }
  return achados;
}
