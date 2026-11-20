import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ClienteLLM, MensagemChat } from './llm';
import { mensagensDaVoz, PERSONAS, respostaFixa, responderComoAgente } from './voz';

/** Cliente falso: devolve `texto` ou lança, e guarda as mensagens que recebeu. */
function falso(texto: string | Error) {
  const recebidas: MensagemChat[][] = [];
  const cliente = {
    configurado: true,
    async conversar(m: MensagemChat[]) {
      recebidas.push(m);
      if (texto instanceof Error) throw texto;
      return { texto, fornecedor: 'falso', modelo: 'falso' };
    },
  } as unknown as ClienteLLM;
  return { cliente, recebidas };
}

describe('shared/voz', () => {
  it('responde no papel do agente, só com o estado, e limita a 3 frases', async () => {
    const { cliente, recebidas } = falso('Uma. Duas. Três. Quatro.');
    const r = await responderComoAgente('defesa', 'o que está aberto?', 'Por decidir (1): PostgreSQL', cliente);
    assert.equal(r, 'Uma. Duas. Três.');
    assert.match(recebidas[0][0].content, /És a Defesa/);
    assert.match(recebidas[0][0].content, /só acontecem quando o dono carrega em Aprovar/);
    assert.match(recebidas[0][1].content, /ESTADO[^]*PostgreSQL[^]*PERGUNTA DO DONO[^]*o que está aberto\?/);
  });

  it('sem LLM, com erro ou com resposta vazia: resposta fixa, nunca lança', async () => {
    assert.equal(await responderComoAgente('chefe', 'x', 'y', { configurado: false } as unknown as ClienteLLM), respostaFixa('chefe'));
    assert.equal(await responderComoAgente('migrador', 'x', 'y', falso(new Error('timeout')).cliente), respostaFixa('migrador'));
    assert.equal(await responderComoAgente('atacante', 'x', 'y', falso('').cliente), respostaFixa('atacante'));
  });

  it('corta pergunta e estado gigantes (a pergunta vem do Telegram)', () => {
    const [, user] = mensagensDaVoz('chefe', 'p'.repeat(5000), 'e'.repeat(9000));
    assert.ok(user.content.length < 2700);
  });

  it('há persona para os 4 agentes', () => {
    assert.deepEqual(Object.keys(PERSONAS).sort(), ['atacante', 'chefe', 'defesa', 'migrador']);
  });
});
