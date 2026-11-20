import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AllowlistInvalidaError,
  AlvoRecusadoError,
  carregarAllowlist,
  filtrarAlvos,
  garantirPermitido,
} from '../alvos';
import { paraAchado } from '../reconhecimento';
import { executarForcaBruta, lerWordlist } from '../index';

const LISTA = '203.0.113.10, 198.51.100.7';

describe('atacante/alvos', () => {
  it('lê IPs literais e ignora espaços e entradas vazias', () => {
    const lista = carregarAllowlist(' 203.0.113.10 ,, 198.51.100.7 ');
    assert.deepEqual([...lista], ['203.0.113.10', '198.51.100.7']);
  });

  it('lista vazia ou em falta recusa tudo', () => {
    for (const valor of [undefined, '', '   ', ',,']) {
      const lista = carregarAllowlist(valor);
      assert.equal(lista.size, 0);
      assert.throws(() => garantirPermitido('203.0.113.10', lista), AlvoRecusadoError);
    }
  });

  it('falha fechado se uma entrada não for IP literal', () => {
    assert.throws(() => carregarAllowlist('203.0.113.10, exemplo.com'), AllowlistInvalidaError);
    assert.throws(() => carregarAllowlist('10.0.0.0/8'), AllowlistInvalidaError);
  });

  it('garantirPermitido aceita só quem está na lista', () => {
    const lista = carregarAllowlist(LISTA);
    garantirPermitido('203.0.113.10', lista);
    garantirPermitido(' 203.0.113.10 ', lista);
    assert.throws(() => garantirPermitido('203.0.113.11', lista), AlvoRecusadoError);
  });

  it('filtrarAlvos separa sem contactar e normaliza os espaços', () => {
    const { permitidos, recusados } = filtrarAlvos(
      ['203.0.113.10', '203.0.113.11', ' 198.51.100.7 '],
      carregarAllowlist(LISTA),
    );
    assert.deepEqual(permitidos, ['203.0.113.10', '198.51.100.7']);
    assert.deepEqual(recusados, ['203.0.113.11']);
  });
});

describe('atacante/reconhecimento', () => {
  it('porta aberta vira achado servico-exposto, com nome e gravidade', () => {
    const achado = paraAchado({ alvo: '203.0.113.10', porta: 5432, estado: 'aberta' });
    assert.equal(achado.tipo, 'servico-exposto');
    assert.equal(achado.origem, 'atacante');
    assert.equal(achado.servico, 'PostgreSQL');
    assert.equal(achado.severidade, 'alta');
    assert.equal(achado.alvo, '203.0.113.10');
    assert.equal(achado.porta, 5432);
    assert.match(achado.id, /^atacante-203\.0\.113\.10-5432$/);
  });

  it('porta fora do mapa fica sem serviço e com gravidade média', () => {
    const achado = paraAchado({ alvo: '203.0.113.10', porta: 8080, estado: 'aberta' });
    assert.equal(achado.servico, null);
    assert.equal(achado.severidade, 'media');
  });
});

describe('atacante/ssh', () => {
  it('lê a wordlist e ignora comentários, linhas vazias e repetidas', () => {
    const lista = lerWordlist('\uFEFF# comentário\r\ndeploy\r\n\r\n  deploy123  \ndeploy\r\n');
    assert.deepEqual(lista, ['deploy', 'deploy123']);
  });

  it('recusa o alvo fora da allowlist antes de qualquer ligação', async () => {
    await assert.rejects(
      executarForcaBruta({
        alvo: '203.0.113.11',
        senhas: ['deploy123'],
        allowlist: carregarAllowlist('203.0.113.10'),
        pausaMs: 0,
        log: () => {},
      }),
      AlvoRecusadoError,
    );
  });
});
