import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { varrerSegredos, varrerTexto } from '../segredos';

describe('atacante/segredos', () => {
  it('encontra a chave de acesso e o segredo AWS sem copiar os valores', () => {
    const texto = [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'AWS_SECRET_ACCESS_KEY=FICTICIO-nao-e-uma-chave-real-0000000000',
      'const limpo = 1;',
    ].join('\n');
    const encontrados = varrerTexto(texto, 'app.env');
    assert.deepEqual(
      encontrados.map((s) => [s.tipo, s.linha]),
      [
        ['aws-access-key', 1],
        ['aws-secret', 2],
      ],
    );
    const json = JSON.stringify(encontrados);
    assert.ok(!json.includes('FICTICIO'));
    assert.ok(!json.includes('AKIAIOSFODNN7EXAMPLE'));
  });

  it('ignora placeholders e valores de exemplo', () => {
    const texto = [
      'AWS_SECRET_ACCESS_KEY=<senha>',
      'AWS_SECRET_ACCESS_KEY=${SEGREDO}',
      'AWS_SECRET_ACCESS_KEY=changeme',
    ].join('\n');
    assert.deepEqual(varrerTexto(texto, 'exemplo.env'), []);
  });

  it('varre a pasta e ignora node_modules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atacante-segredos-'));
    try {
      await mkdir(join(dir, 'node_modules'));
      await writeFile(join(dir, '.env'), 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n');
      await writeFile(join(dir, 'node_modules', 'ignorar.ts'), 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n');
      const encontrados = await varrerSegredos(dir);
      assert.deepEqual(
        encontrados.map((s) => s.ficheiro),
        ['.env'],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
