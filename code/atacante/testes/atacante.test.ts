import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlvoRecusadoError, carregarAllowlist } from '../alvos';
import { paraAchado } from '../reconhecimento';
import { executarForcaBruta, lerWordlist } from '../index';

describe('atacante/reconhecimento', () => {
  it('porta aberta vira achado servico-exposto, com nome e gravidade', () => {
    const achado = paraAchado({ alvo: '203.0.113.10', porta: 5432, estado: 'aberta' });
    assert.equal(achado.tipo, 'servico-exposto');
    assert.equal(achado.origem, 'atacante');
    assert.equal(achado.servico, 'PostgreSQL');
    assert.equal(achado.severidade, 'alta');
    assert.equal(achado.alvo, '203.0.113.10');
    assert.equal(achado.porta, 5432);
    assert.equal(achado.securityGroupId, undefined);
    assert.equal(achado.regra, undefined);
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
