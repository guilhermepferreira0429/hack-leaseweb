import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlvoRecusadoError, carregarAllowlist } from '../alvos';
import { CREDENCIAIS_POR_DEFEITO, testarCredenciaisPorDefeito, verificarBucketPublico } from '../credenciais';
import { executarExtras } from '../extras';

const ALLOW = carregarAllowlist('203.0.113.10');

describe('atacante/credenciais', () => {
  it('lista as credenciais de fábrica conhecidas', () => {
    assert.deepEqual(
      CREDENCIAIS_POR_DEFEITO.map((c) => [c.servico, c.porta]),
      [
        ['PostgreSQL', 5432],
        ['MinIO', 9000],
        ['RabbitMQ', 15672],
        ['Redis', 6379],
      ],
    );
  });

  it('recusa o alvo fora da allowlist antes de qualquer ligação', async () => {
    await assert.rejects(testarCredenciaisPorDefeito('203.0.113.11', ALLOW), AlvoRecusadoError);
    await assert.rejects(verificarBucketPublico('203.0.113.11', 9000, 'faturas', ALLOW), AlvoRecusadoError);
    await assert.rejects(executarExtras('203.0.113.11', ALLOW), AlvoRecusadoError);
  });
});
