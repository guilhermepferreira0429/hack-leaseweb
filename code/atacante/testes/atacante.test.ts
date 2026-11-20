import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlvoRecusadoError, carregarAllowlist } from '../alvos';
import { PORTAS_ALVO, paraAchado, portasDoAmbiente, reconhecer, verificarPortas } from '../reconhecimento';
import { executarForcaBruta, lerWordlist } from '../index';

const ALLOW = carregarAllowlist('203.0.113.10');

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

  it('cobre as portas sensíveis da arquitetura e do mapeamento AWS', () => {
    const sensiveis = [22, 23, 445, 1433, 3306, 3389, 5432, 5984, 6379, 9200, 27017];
    for (const porta of sensiveis) {
      assert.ok((PORTAS_ALVO as readonly number[]).includes(porta), `porta ${porta}`);
    }
    assert.ok((PORTAS_ALVO as readonly number[]).includes(80));
    assert.ok((PORTAS_ALVO as readonly number[]).includes(443));
    assert.equal(new Set(PORTAS_ALVO).size, PORTAS_ALVO.length);
  });

  it('classifica como alta todas as portas sensíveis de docs/arquitetura.md', () => {
    const esperado: [number, string][] = [
      [22, 'SSH'],
      [23, 'Telnet'],
      [445, 'SMB'],
      [1433, 'SQL Server'],
      [3306, 'MySQL'],
      [3389, 'RDP'],
      [5432, 'PostgreSQL'],
      [5984, 'CouchDB'],
      [6379, 'Redis'],
      [9200, 'Elasticsearch'],
      [27017, 'MongoDB'],
    ];
    for (const [porta, servico] of esperado) {
      const achado = paraAchado({ alvo: '203.0.113.10', porta, estado: 'aberta' });
      assert.equal(achado.servico, servico, `serviço da porta ${porta}`);
      assert.equal(achado.severidade, 'alta', `gravidade da porta ${porta}`);
    }
  });

  it('ATACANTE_IGNORAR_PORTAS tira portas da verificação (ex.: 22 só aberta aos nossos IPs)', () => {
    const sem22 = portasDoAmbiente('22');
    assert.ok(!sem22.includes(22));
    assert.ok(sem22.includes(5432));
    assert.deepEqual(portasDoAmbiente(''), PORTAS_ALVO);
    // Entradas inválidas não rebentam nem alargam a lista; a vírgula final é tolerada.
    assert.ok(!portasDoAmbiente(' 22 , abc, 70000, -1, 0,').includes(22));
  });

  it('recusa o alvo fora da allowlist antes de qualquer ligação', async () => {
    await assert.rejects(reconhecer(['203.0.113.11'], ALLOW), AlvoRecusadoError);
    await assert.rejects(verificarPortas('203.0.113.11', ALLOW), AlvoRecusadoError);
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
        allowlist: ALLOW,
        pausaMs: 0,
        log: () => {},
      }),
      AlvoRecusadoError,
    );
  });
});
