// Reconhecimento leve e não destrutivo: uma ligação TCP curta às portas da demo num alvo da allowlist.
// Não há exploração, escrita nem força bruta. Visto de fora, uma porta filtrada e uma fechada
// parecem iguais (timeout): por isso só se reporta "aberta" ou "fechada".
import { Socket } from 'node:net';
import type { Achado } from '@mwbe/shared';
import { carregarEnv } from '@mwbe/shared';
import { carregarAllowlist, garantirPermitido } from './alvos';

/**
 * Portas verificadas: as sensíveis de docs/arquitetura.md e da tabela "Refuses to copy" de
 * docs/research/aws-to-leaseweb-mapping.md, mais HTTP/HTTPS da demo.
 */
export const PORTAS_ALVO = [22, 23, 80, 443, 445, 1433, 3306, 3389, 5432, 5984, 6379, 9200, 27017] as const;

/** Tempo máximo por porta. Uma porta filtrada esgota isto; as restantes respondem de imediato. */
export const TIMEOUT_PORTA_MS = 2_000;

export type EstadoPorta = 'aberta' | 'fechada';

export interface PortaTestada {
  alvo: string;
  porta: number;
  estado: EstadoPorta;
}

/**
 * Nome e gravidade das portas de docs/arquitetura.md. `PORTAS_ALVO` é a lista que o reconhece,
 * mas `paraAchado` tem de classificar bem qualquer porta que o chamador peça.
 */
const SERVICOS: Record<number, { nome: string; severidade: Achado['severidade'] }> = {
  22: { nome: 'SSH', severidade: 'alta' },
  23: { nome: 'Telnet', severidade: 'alta' },
  80: { nome: 'HTTP', severidade: 'media' },
  443: { nome: 'HTTPS', severidade: 'media' },
  445: { nome: 'SMB', severidade: 'alta' },
  1433: { nome: 'SQL Server', severidade: 'alta' },
  3306: { nome: 'MySQL', severidade: 'alta' },
  3389: { nome: 'RDP', severidade: 'alta' },
  5432: { nome: 'PostgreSQL', severidade: 'alta' },
  5984: { nome: 'CouchDB', severidade: 'alta' },
  6379: { nome: 'Redis', severidade: 'alta' },
  9200: { nome: 'Elasticsearch', severidade: 'alta' },
  27017: { nome: 'MongoDB', severidade: 'alta' },
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

/**
 * Recusa IPs fora de ALVOS_PERMITIDOS; testa os restantes e devolve só as portas abertas.
 * `portas` permite à confirmação do fecho verificar só a porta que acabou de ser fechada.
 */
export async function reconhecer(
  alvos: string[],
  allowlist: ReadonlySet<string> = allowlistDoAmbiente(),
  portas: readonly number[] = PORTAS_ALVO,
): Promise<Achado[]> {
  // Primeiro valida todos: se um alvo não estiver na lista, nada é contactado.
  for (const alvo of alvos) garantirPermitido(alvo, allowlist);

  const achados: Achado[] = [];
  for (const alvo of alvos) {
    for (const porta of await verificarPortas(alvo, allowlist, portas)) {
      if (porta.estado === 'aberta') achados.push(paraAchado(porta));
    }
  }
  return achados;
}
