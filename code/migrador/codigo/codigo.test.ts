import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { encontrarUsosAws, FICHEIRO_CONFIG, migrarCodigo, proporAlteracao, semSegredos, validarAlteracao } from './index';

const SENHA = 'senhaMuitoSecreta42';
const CHAVE = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';

/** Uma app "legada", presa à AWS: cliente S3 sem path-style, RDS e credenciais no .env.example. */
async function appLegada(): Promise<{ raiz: string; dirApp: string }> {
  const raiz = await mkdtemp(join(tmpdir(), 'codigo-teste-'));
  const dirApp = join(raiz, 'app');
  await mkdir(join(dirApp, 'src'), { recursive: true });
  await mkdir(join(dirApp, 'node_modules', 'x'), { recursive: true });
  await writeFile(
    join(dirApp, 'src', 'armazenamento.ts'),
    [
      "import { S3Client } from '@aws-sdk/client-s3';",
      '',
      '// Antes era tudo na AWS (amazonaws.com).',
      'export const s3 = new S3Client({',
      '  region: process.env.AWS_REGION,',
      '});',
      "export const bucket = process.env.S3_BUCKET ?? 'faturas';",
      '',
    ].join('\n'),
  );
  await writeFile(join(dirApp, 'src', 'fila.ts'), "import { SQSClient } from '@aws-sdk/client-sqs';\nexport const sqs = new SQSClient({});\n");
  await writeFile(
    join(dirApp, '.env.example'),
    [`DATABASE_URL=postgres://app:${SENHA}@loja.abc123.eu-west-1.rds.amazonaws.com:5432/loja`, 'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP', `AWS_SECRET_ACCESS_KEY=${CHAVE}`, ''].join('\n'),
  );
  await writeFile(join(dirApp, 'node_modules', 'x', 'index.js'), "require('@aws-sdk/client-s3')\n");
  return { raiz, dirApp };
}

describe('migrador de código', () => {
  it('encontra o que prende a app à AWS, sem nunca devolver um segredo', async () => {
    const { dirApp } = await appLegada();
    const usos = await encontrarUsosAws(dirApp);
    const tipos = usos.map((u) => `${u.ficheiro}:${u.linha}:${u.servico}:${u.tipo}`);
    assert.ok(tipos.includes('src/armazenamento.ts:4:s3:s3-sem-path-style'));
    assert.ok(tipos.includes('src/armazenamento.ts:1:s3:sdk'));
    assert.ok(tipos.includes('src/fila.ts:1:fila:sdk'));
    assert.ok(tipos.includes('.env.example:1:postgres:endpoint'));
    assert.ok(usos.some((u) => u.tipo === 'credencial' && u.nome === 'AWS_SECRET_ACCESS_KEY'));
    assert.ok(!usos.some((u) => u.ficheiro.startsWith('node_modules')), 'node_modules fica de fora');
    assert.ok(!usos.some((u) => u.linha === 3 && u.tipo === 'endpoint'), 'um comentário não é um endereço em uso');
    const tudo = JSON.stringify(usos);
    assert.ok(!tudo.includes(SENHA) && !tudo.includes(CHAVE) && !tudo.includes('AKIAABCDEFGHIJKLMNOP'));
  });

  it('semSegredos tira valores de nomes sensíveis, senhas em URLs e chaves AKIA', () => {
    assert.equal(semSegredos('DB_PASSWORD=abc'), 'DB_PASSWORD=***');
    assert.equal(semSegredos('postgres://u:abc@h:5432/x'), 'postgres://u:***@h:5432/x');
    assert.equal(semSegredos('chave AKIAABCDEFGHIJKLMNOP'), 'chave ***');
    assert.equal(semSegredos("secretKey: process.env.X"), 'secretKey: process.env.X', 'uma referência não é um segredo');
  });

  it('propõe só forcePathStyle e a configuração da Leaseweb; a validação aceita', async () => {
    const { dirApp } = await appLegada();
    const usos = await encontrarUsosAws(dirApp);
    const p = await proporAlteracao(dirApp, usos);
    assert.deepEqual(p.alteracoes.map((a) => a.ficheiro).sort(), [FICHEIRO_CONFIG, 'src/armazenamento.ts']);
    const s3 = p.alteracoes.find((a) => a.ficheiro === 'src/armazenamento.ts')!;
    assert.match(s3.depois, /new S3Client\(\{\n  forcePathStyle: true, \/\/ o MinIO na Leaseweb usa path-style\n  region: process\.env\.AWS_REGION,/);
    const config = p.alteracoes.find((a) => a.ficheiro === FICHEIRO_CONFIG)!;
    assert.equal(config.antes, null);
    assert.match(config.depois, /DATABASE_URL=postgres:\/\/<utilizador>:<senha>@<postgres-na-leaseweb>:5432\/<base>/);
    assert.match(config.depois, /# AWS_SECRET_ACCESS_KEY/);
    assert.ok(p.fora.some((f) => /SQS → RabbitMQ: a app chama o SQS diretamente/.test(f)), 'trocar o cliente SQS fica fora (nível B)');
    assert.ok(p.fora.some((f) => /\.env\.example:1: endereço da AWS/.test(f)));
    assert.deepEqual(validarAlteracao(p, usos), []);
    assert.ok(!p.diff.includes(SENHA) && !p.diff.includes(CHAVE));
    assert.match(p.diff, /\+  forcePathStyle: true/);
  });

  it('a validação recusa segredos, ficheiros fora do esperado e código apagado', async () => {
    const { dirApp } = await appLegada();
    const usos = await encontrarUsosAws(dirApp);
    const p = await proporAlteracao(dirApp, usos);
    const config = p.alteracoes.find((a) => a.ficheiro === FICHEIRO_CONFIG)!;
    const s3 = p.alteracoes.find((a) => a.ficheiro === 'src/armazenamento.ts')!;
    const mau = {
      ...p,
      alteracoes: [
        { ...config, depois: `${config.depois}DB_PASSWORD=${SENHA}\nX=postgres://a:${SENHA}@h/x\n` },
        { ...s3, depois: s3.depois.replace("export const bucket = process.env.S3_BUCKET ?? 'faturas';\n", '') },
        { ficheiro: 'src/outro.ts', antes: null, depois: 'export {}', motivo: 'x' },
      ],
    };
    const problemas = validarAlteracao(mau, usos);
    assert.ok(problemas.some((x) => /leaseweb\.env\.example: uma linha nova parece ter um segredo/.test(x)));
    assert.ok(problemas.some((x) => /src\/armazenamento\.ts: o PR apagaria código/.test(x)));
    assert.ok(problemas.some((x) => /src\/outro\.ts: ficheiro fora do esperado/.test(x)));
  });

  it('sem testes a passar não há PR; por omissão o PR é simulado (diff num ficheiro)', async () => {
    const { raiz, dirApp } = await appLegada();
    const sem = await migrarCodigo(dirApp, { raizRepo: raiz, id: 'ab12cd34', testesOk: false });
    assert.equal(sem.pr, undefined);
    assert.ok(sem.problemas.some((p) => /testes da app não passaram/.test(p)));

    const sim = await migrarCodigo(dirApp, { raizRepo: raiz, id: 'ab12cd34', testesOk: true });
    assert.equal(sim.pr?.simulado, true);
    assert.equal(sim.pr?.ramo, 'migrador/leaseweb-ab12cd34');
    assert.deepEqual(sim.pr?.ficheiros.sort(), ['app/leaseweb.env.example', 'app/src/armazenamento.ts']);
    const diff = await readFile(sim.pr!.diffEm!, 'utf8');
    assert.match(diff, /forcePathStyle: true/);
    assert.ok(!diff.includes(SENHA));
  });

  it('PR real: worktree num ramo novo, push só desse ramo e PR para main; nunca push para main', async () => {
    const { raiz, dirApp } = await appLegada();
    const comandos: string[] = [];
    const r = await migrarCodigo(dirApp, {
      raizRepo: raiz,
      id: 'ab12cd34',
      testesOk: true,
      real: true,
      executar: async (cmd, args) => {
        comandos.push(`${cmd} ${args.join(' ')}`);
        return cmd === 'gh' ? 'https://github.com/exemplo/repo/pull/7' : '';
      },
    });
    assert.equal(r.pr?.url, 'https://github.com/exemplo/repo/pull/7');
    assert.ok(comandos[0]!.startsWith('git worktree add -b migrador/leaseweb-ab12cd34 '));
    assert.ok(comandos.includes('git push -u origin migrador/leaseweb-ab12cd34:migrador/leaseweb-ab12cd34'));
    assert.ok(comandos.some((c) => c.startsWith('gh pr create --base main --head migrador/leaseweb-ab12cd34')));
    assert.ok(!comandos.some((c) => /git push\b.*\bmain\b/.test(c)), 'nunca há push para main');
    assert.ok(comandos.at(-1)!.startsWith('git worktree remove'), 'a worktree temporária sai sempre');
  });
});
