import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paraModo, simplificar } from './glossario';

describe('shared/glossario', () => {
  it('troca o jargão por palavras simples', () => {
    assert.equal(simplificar('S3 -> MinIO'), 'AWS file storage -> object storage');
    assert.equal(simplificar('Queues: 50 messages moved to RabbitMQ'), 'Queues: 50 messages moved to message queue');
    assert.equal(simplificar('Secrets: 16 moved to OpenBao'), 'Secrets: 16 moved to secrets vault');
    assert.equal(simplificar('Cache: 594 keys copied to Valkey'), 'Cache: 594 keys copied to cache');
  });

  it('o termo mais longo ganha ao mais curto (RDS PostgreSQL antes de PostgreSQL)', () => {
    assert.equal(simplificar('RDS PostgreSQL -> PostgreSQL'), 'AWS managed database -> database');
  });

  it('checksum e security group ficam em palavras simples', () => {
    assert.equal(simplificar('checksum OK'), 'file fingerprint OK');
    assert.equal(simplificar('the security group was open'), 'the firewall rule was open');
  });

  it('paraModo: só o modo simples troca; o técnico fica igual', () => {
    assert.equal(paraModo('PostgreSQL on port 5432', 'tecnico'), 'PostgreSQL on port 5432');
    assert.equal(paraModo('PostgreSQL on port 5432', 'simples'), 'database on port 5432');
  });

  it('não mexe no que não é jargão', () => {
    assert.equal(simplificar('No data left the EU.'), 'No data left the EU.');
  });
});
