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
    assert.deepEqual(servicos, ['s3', 'postgres', 'fila']);
    assert.match(plano, /MinIO/);
    assert.match(plano, /sha256/);
    assert.match(plano, /SQS → RabbitMQ/);
    const linhas = plano.split('\n');
    assert.ok(linhas.length >= 2 && linhas.length <= 4, `plano com ${linhas.length} linhas`);
  });

  it('só S3: não fala de fase seguinte', async () => {
    const dir = await pasta({ 'src/a.ts': "import { S3Client } from '@aws-sdk/client-s3';" });
    const { servicos, plano } = await analisar(dir);
    assert.deepEqual(servicos, ['s3']);
    assert.doesNotMatch(plano, /fase seguinte/);
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

  it('pasta vazia e pasta inexistente', async () => {
    assert.deepEqual((await analisar(await pasta({}))).servicos, []);
    await assert.rejects(analisar(join(tmpdir(), 'nao-existe-migrador-xyz')), /não existe/);
  });
});

describe('migrador: sha256', () => {
  it('bate com o vetor conhecido', () => {
    assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
