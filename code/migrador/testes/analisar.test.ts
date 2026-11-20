// Testes sem infraestrutura: analisar() e sha256(). A cópia S3 -> MinIO prova-se com `npm run dev:migrador`.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analisar } from '../analisar';
import { sha256 } from '../migrar-dados';

const EXEMPLO_APP = fileURLToPath(new URL('../../exemplo-app', import.meta.url));

describe('migrador: analisar', () => {
  const temporarias: string[] = [];
  after(async () => {
    for (const d of temporarias) await rm(d, { recursive: true, force: true });
  });
  const pasta = async (ficheiros: Record<string, string>): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'migrador-'));
    temporarias.push(dir);
    for (const [nome, texto] of Object.entries(ficheiros)) {
      await mkdir(join(dir, nome, '..'), { recursive: true });
      await writeFile(join(dir, nome), texto);
    }
    return dir;
  };

  it('encontra S3, Postgres e SQS na exemplo-app e propõe o MinIO', async () => {
    const { servicos, plano } = await analisar(EXEMPLO_APP);
    // A app vai ganhando serviços (segredos, cache); estes três estão sempre e vêm primeiro.
    assert.deepEqual(servicos.slice(0, 3), ['s3', 'postgres', 'fila']);
    assert.match(plano, /MinIO/);
    assert.match(plano, /sha256/);
    assert.match(plano, /SQS → RabbitMQ/);
    const linhas = plano.split('\n');
    assert.ok(linhas.length >= 2 && linhas.length <= 4, `plano com ${linhas.length} linhas`);
  });

  it('só S3: propõe só o MinIO e garante que nada é apagado', async () => {
    const dir = await pasta({ 'src/a.ts': "import { S3Client } from '@aws-sdk/client-s3';" });
    const { servicos, plano } = await analisar(dir);
    assert.deepEqual(servicos, ['s3']);
    assert.match(plano, /S3 → MinIO/);
    assert.doesNotMatch(plano, /RabbitMQ|PostgreSQL/);
    assert.match(plano, /checksum-verified/);
  });

  it('sem S3: não propõe migração e ignora node_modules', async () => {
    const dir = await pasta({
      'package.json': '{ "dependencies": { "pg": "^8" } }',
      'node_modules/x/index.js': "require('@aws-sdk/client-s3')",
    });
    const { servicos, plano } = await analisar(dir);
    assert.deepEqual(servicos, ['postgres']);
    assert.doesNotMatch(plano, /MinIO/);
  });

  it('segredos e cache, pela ordem fixa; seed/ não conta como app', async () => {
    const dir = await pasta({
      'src/config.ts': "import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';",
      'src/cache.ts': "import { createClient } from 'redis';",
      'src/ficheiros.ts': "import { S3Client } from '@aws-sdk/client-s3';",
      'seed/semear.ts': "import { SQSClient } from '@aws-sdk/client-sqs';",
    });
    const { servicos, plano } = await analisar(dir);
    assert.deepEqual(servicos, ['s3', 'segredos', 'cache']);
    assert.match(plano, /Secrets Manager\/SSM → OpenBao/);
    assert.match(plano, /ElastiCache → Valkey/);
    assert.match(plano, /checksum-verified/);
    assert.ok(plano.split('\n').length <= 3, 'plano curto: no máximo 3 linhas no grupo');
  });

  it('pasta vazia e pasta inexistente', async () => {
    assert.deepEqual((await analisar(await pasta({}))).servicos, []);
    await assert.rejects(analisar(join(tmpdir(), 'nao-existe-migrador-xyz')), /not found/);
  });
});

describe('migrador: sha256', () => {
  it('bate com o vetor conhecido', () => {
    assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
