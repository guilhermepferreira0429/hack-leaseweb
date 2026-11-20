// Deteta se o SSH anuncia autenticação por palavra-passe (nível C de docs/ferramentas.md).
// Não envia palavra-passe nenhuma: tenta o método 'none' e lê os métodos que o servidor aceita.
// A allowlist é conferida antes da ligação; não há força bruta nem escrita.
import { Client } from 'ssh2';
import type { Achado } from '@mwbe/shared';
import { garantirPermitido } from './alvos';

export const TIMEOUT_SSH_AUTH_MS = 4_000;
/** Utilizador da VM da demo; o servidor responde com os métodos que aceita. */
export const UTILIZADOR_PROBE = 'deploy';

export interface OpcoesSshAuth {
  porta?: number;
  timeoutMs?: number;
}

/** Função pura: os métodos anunciados incluem palavra-passe? */
export function avaliarMetodosSsh(alvo: string, metodos: readonly string[], porta = 22): Achado[] {
  if (!metodos.includes('password')) return [];
  return [
    {
      id: `ssh-${alvo}-${porta}-password`,
      tipo: 'servico-exposto',
      origem: 'atacante',
      alvo,
      porta,
      servico: 'SSH (password login)',
      severidade: 'media',
      detalhe: `SSH advertises password authentication (${metodos.join(', ')})`,
    },
  ];
}

/**
 * Liga ao SSH, faz uma única tentativa 'none' (sem credenciais) e devolve os métodos anunciados.
 * Uma porta fechada ou um servidor que aceite 'none' devolvem [].
 */
export async function verificarSshPassword(
  alvo: string,
  allowlist: ReadonlySet<string>,
  opcoes: OpcoesSshAuth = {},
): Promise<Achado[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);
  const porta = opcoes.porta ?? 22;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_SSH_AUTH_MS;

  const metodos = await new Promise<string[]>((concluir) => {
    const cliente = new Client();
    let terminado = false;
    let timer: NodeJS.Timeout | undefined;

    const fim = (resultado: string[]) => {
      if (terminado) return;
      terminado = true;
      if (timer) clearTimeout(timer);
      cliente.end();
      concluir(resultado);
    };

    cliente.on('ready', () => fim([])); // 'none' não devia autenticar
    cliente.on('error', () => fim([]));
    cliente.on('close', () => fim([]));
    cliente.connect({
      host: endereco,
      port: porta,
      username: UTILIZADOR_PROBE,
      tryKeyboard: false,
      readyTimeout: timeoutMs,
      authHandler: (restantes, _parcial, proximo) => {
        if (restantes === null) {
          // Primeira tentativa: 'none' não envia credenciais e faz o servidor listar os métodos.
          proximo({ type: 'none', username: UTILIZADOR_PROBE });
          return;
        }
        fim(restantes);
      },
    });

    timer = setTimeout(() => fim([]), timeoutMs + 500);
    timer.unref?.();
  });

  return avaliarMetodosSsh(endereco, metodos, porta);
}
