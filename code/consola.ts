// Modo --consola do orquestrador: o terminal faz de Telegram e de grupo "Direção".
// Serve para ensaiar sem bots e é o plano B da demo. Continua a haver aprovação humana:
// cada pedido pergunta "Aprovar? [s/N]" e só "s" aprova. Linhas começadas por "/" são comandos
// (/estado, /desfazer <id>), como no Telegram.
import { createInterface } from 'node:readline';
import type { Agente, Decisao, Mensagem, Pedido } from '@mwbe/shared';

export const DONO_CONSOLA = 'consola';

export function criarConsola(entrada: NodeJS.ReadableStream = process.stdin, escrever = (t: string) => process.stdout.write(t)) {
  const rl = createInterface({ input: entrada });
  const linhas: string[] = [];
  const esperas: ((l: string | undefined) => void)[] = [];
  let fechado = false;
  let aoResponder: ((id: string, d: Decisao, quem: string) => void) | undefined;
  let aoMensagem: ((a: Agente | null, t: string) => void) | undefined;
  let perguntas: Promise<void> = Promise.resolve();

  rl.on('line', (linha) => {
    if (linha.trim().startsWith('/')) return void aoMensagem?.(null, linha.trim());
    const espera = esperas.shift();
    if (espera) espera(linha);
    else linhas.push(linha);
  });
  rl.on('close', () => {
    fechado = true;
    for (const espera of esperas.splice(0)) espera(undefined);
  });

  const proximaLinha = (): Promise<string | undefined> => {
    if (linhas.length > 0) return Promise.resolve(linhas.shift());
    if (fechado) return Promise.resolve(undefined);
    return new Promise((r) => esperas.push(r));
  };

  const telegram = {
    /** Mostra o pedido e põe a pergunta na fila (uma de cada vez); não fica à espera da resposta. */
    async pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void> {
      perguntas = perguntas.then(async () => {
        escrever(`\n┌ ${agente.toUpperCase()} pede aprovação [${pedido.id}]: ${pedido.titulo}\n`);
        for (const l of pedido.texto.split('\n')) escrever(`│ ${l}\n`);
        escrever('└ Aprovar? [s/N] ');
        const resposta = await proximaLinha();
        const decisao: Decisao = /^s(im)?$/i.test(resposta?.trim() ?? '') ? 'aprovar' : 'ignorar';
        escrever(`${resposta === undefined ? '(sem resposta) ' : ''}-> ${decisao}\n`);
        aoResponder?.(pedido.id, decisao, DONO_CONSOLA);
      });
    },
    aoResponder(cb: (id: string, d: Decisao, quem: string) => void): void {
      aoResponder = cb;
    },
    aoMensagemDoDono(cb: (a: Agente | null, t: string) => void): void {
      aoMensagem = cb;
    },
    async notificar(texto: string): Promise<void> {
      escrever(`\n[aviso] ${texto}\n`);
    },
  };

  const bus = {
    enviar(m: Mensagem): void {
      escrever(`\n[${m.de} → ${m.para}] ${m.texto}\n`);
    },
  };

  return { telegram, bus, fechar: () => rl.close() };
}
