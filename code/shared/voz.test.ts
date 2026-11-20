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
    const { cliente, recebidas } = falso('One. Two. Three. Four.');
    const r = await responderComoAgente('defesa', 'what is open?', 'Pending (1): PostgreSQL', cliente);
    assert.equal(r, 'One. Two. Three.');
    assert.match(recebidas[0][0].content, /You are the Defender/);
    assert.match(recebidas[0][0].content, /changes only happen when the owner presses Approve/);
    assert.match(recebidas[0][1].content, /STATE[^]*PostgreSQL[^]*OWNER'S QUESTION[^]*what is open\?/);
  });

  it('sem LLM, com erro ou com resposta vazia: resposta fixa, nunca lança', async () => {
    assert.equal(await responderComoAgente('chefe', 'x', 'y', { configurado: false } as unknown as ClienteLLM), respostaFixa('chefe'));
    assert.equal(await responderComoAgente('migrador', 'x', 'y', falso(new Error('timeout')).cliente), respostaFixa('migrador'));
    assert.equal(await responderComoAgente('atacante', 'x', 'y', falso('').cliente), respostaFixa('atacante'));
    assert.equal(respostaFixa('defesa'), "I can't answer as the Defender right now. Type /status to see the current status.");
  });

  it('corta pergunta e estado gigantes (a pergunta vem do Telegram)', () => {
    const [, user] = mensagensDaVoz('chefe', 'p'.repeat(5000), 'e'.repeat(9000));
    assert.ok(user.content.length < 2700);
  });

  it('há persona para os 4 agentes', () => {
    assert.deepEqual(Object.keys(PERSONAS).sort(), ['atacante', 'chefe', 'defesa', 'migrador']);
  });

  it('personas: cada uma passa a vez com a menção certa', () => {
    assert.match(PERSONAS.migrador, /hand over to @attacker/);
    assert.match(PERSONAS.atacante, /hand over to @defender/);
    assert.match(PERSONAS.defesa, /ask @attacker to confirm/);
    assert.match(PERSONAS.atacante, /never describe how to exploit a weakness/);
  });

  it('regras comuns em inglês (responde em inglês, primeira pessoa, menções, jargão traduzido)', () => {
    const [sistema] = mensagensDaVoz('chefe', 'x', 'y');
    assert.match(sistema!.content, /Answer in English/);
    assert.match(sistema!.content, /Speak in the first person/);
    assert.match(sistema!.content, /end with their mention: @attacker, @defender, @migrator, @chief/);
    assert.match(sistema!.content, /the database port \(5432\)/);
    assert.match(sistema!.content, /No emojis, except ✓ and ✗/);
    assert.doesNotMatch(sistema!.content, /português|És o|És a/);
  });
});
