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
    assert.ok(p.fora.some((f) => /\.env\.example:1: endereço ou ARN da AWS/.test(f)));
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
    assert.match(sim.pr!.ramo, /^migrador\/leaseweb-ab12cd34-\d{14}$/);
    assert.deepEqual(sim.pr?.ficheiros.sort(), ['app/leaseweb.env.example', 'app/src/armazenamento.ts']);
    const diff = await readFile(sim.pr!.diffEm!, 'utf8');
    assert.match(diff, /forcePathStyle: true/);
    assert.ok(!diff.includes(SENHA));
  });

  it('PR real: ramo novo a partir do origin/main, push só desse ramo e PR para main; nunca push para main', async () => {
    const { raiz, dirApp } = await appLegada();
    const original = await readFile(join(dirApp, 'src', 'armazenamento.ts'), 'utf8');
    const comandos: string[] = [];
    const executar = async (cmd: string, args: string[]) => {
      comandos.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh') return 'https://github.com/exemplo/repo/pull/7';
      if (args[0] === 'show') return original;
      return '';
    };
    const r = await migrarCodigo(dirApp, { raizRepo: raiz, id: 'ab12cd34', testesOk: true, real: true, executar });
    assert.equal(r.pr?.url, 'https://github.com/exemplo/repo/pull/7');
    const ramo = r.pr!.ramo;
    assert.match(ramo, /^migrador\/leaseweb-ab12cd34-\d{14}$/);
    assert.ok(comandos.includes('git show origin/main:app/src/armazenamento.ts'), 'confere o ficheiro no GitHub antes');
    assert.ok(comandos.some((c) => c.startsWith(`git worktree add -b ${ramo} `) && c.endsWith(' origin/main')), 'sai do origin/main, não do HEAD local');
    assert.ok(comandos.includes(`git push -u origin ${ramo}:${ramo}`));
    assert.ok(comandos.some((c) => c.startsWith(`gh pr create --base main --head ${ramo}`)));
    assert.ok(!comandos.some((c) => /git push\b.*\bmain\b/.test(c)), 'nunca há push para main');
    assert.ok(comandos.some((c) => c.startsWith('git worktree remove')), 'a worktree temporária sai sempre');
    assert.equal(comandos.at(-1), `git branch -D ${ramo}`, 'o ramo local sai no fim');
  });

  it('PR real recusado se o ficheiro no GitHub for diferente do local (falta o push do revisor)', async () => {
    const { raiz, dirApp } = await appLegada();
    const comandos: string[] = [];
    await assert.rejects(
      migrarCodigo(dirApp, {
        raizRepo: raiz,
        id: 'x',
        testesOk: true,
        real: true,
        executar: async (cmd, args) => (comandos.push(`${cmd} ${args.join(' ')}`), 'outra versão'),
      }),
      /no origin\/main não é igual ao local/,
    );
    assert.ok(!comandos.some((c) => /worktree add|push/.test(c)), 'não cria ramo nem faz push');
  });

  it('revisão: senhas em URLs (utilizador vazio, / e @), chaves JSON e .env só com nomes', async () => {
    assert.equal(semSegredos('REDIS_ORIGEM_URL=redis://:s3nh4@127.0.0.1:6380'), 'REDIS_ORIGEM_URL=redis://:***@127.0.0.1:6380');
    assert.equal(semSegredos('amqp://app:ab/cd@h'), 'amqp://app:***@h');
    assert.equal(semSegredos('postgres://app:p@ss@h:5432/x'), 'postgres://app:***@h:5432/x');
    assert.equal(semSegredos('{"endpoint":"https://s3.amazonaws.com","secretKey":"abc"}'), '{"endpoint":"https://s3.amazonaws.com","secretKey":"***"}');
    assert.equal(semSegredos('LLM_KEY=abc'), 'LLM_KEY=***');
    assert.equal(semSegredos('DATABASE_URL=postgres://<utilizador>:<senha>@h/x'), 'DATABASE_URL=postgres://<utilizador>:<senha>@h/x', 'marcadores ficam');

    const { dirApp } = await appLegada();
    await writeFile(join(dirApp, '.env'), 'APP_REDIS_URL=redis://:muitoSecreta@h:6379\nDB_SENHA=abc\n');
    const usos = await encontrarUsosAws(dirApp);
    const doEnv = usos.filter((u) => u.ficheiro === '.env');
    assert.ok(doEnv.some((u) => u.nome === 'APP_REDIS_URL' && u.servico === 'cache'), 'APP_REDIS_URL conta como cache');
    assert.ok(doEnv.every((u) => u.trecho.endsWith('=***')), 'do .env só sai o nome');
    assert.ok(!JSON.stringify(usos).includes('muitoSecreta'));
  });

  it('revisão: deteção mais larga (SDK v2, presigner, rds-signer, ARN, FATURAS_BUCKET, AWS_REGION, segredos)', async () => {
    const { dirApp } = await appLegada();
    await writeFile(
      join(dirApp, 'src', 'mais.ts'),
      [
        "import AWS from 'aws-sdk';",
        "import { getSignedUrl } from '@aws-sdk/s3-request-presigner';",
        "import { Signer } from '@aws-sdk/rds-signer';",
        "const topico = 'arn:aws:sns:eu-west-1:123456789012:encomendas';",
        'const b = process.env.FATURAS_BUCKET;',
        'const r = process.env.AWS_REGION;',
        'const s = process.env.SEGREDOS_TIPO;',
        'const c = new S3Client(config);',
        "const d = new S3Client({ region: 'x', forcePathStyle: process.env.PATH_STYLE === 'true' });",
        '',
      ].join('\n'),
    );
    const usos = (await encontrarUsosAws(dirApp)).filter((u) => u.ficheiro === 'src/mais.ts');
    const tem = (linha: number, servico: string, tipo: string) => usos.some((u) => u.linha === linha && u.servico === servico && u.tipo === tipo);
    assert.ok(tem(1, 'outro', 'sdk'), 'aws-sdk v2');
    assert.ok(tem(2, 's3', 'sdk'), 'presigner');
    assert.ok(tem(3, 'postgres', 'sdk'), 'rds-signer');
    assert.ok(tem(4, 'outro', 'endpoint'), 'ARN');
    assert.ok(usos.some((u) => u.nome === 'FATURAS_BUCKET' && u.servico === 's3'));
    assert.ok(usos.some((u) => u.nome === 'AWS_REGION' && u.servico === 'outro'));
    assert.ok(usos.some((u) => u.nome === 'SEGREDOS_TIPO' && u.servico === 'segredos'));
    assert.ok(tem(8, 's3', 's3-config-externa'), 'cliente a partir de uma variável vai para o fora');
    assert.ok(!usos.some((u) => u.linha === 9 && u.tipo.startsWith('s3-')), 'qualquer forcePathStyle conta como resolvido');

    const todos = await encontrarUsosAws(dirApp);
    const p = await proporAlteracao(dirApp, todos);
    const config = p.alteracoes.find((a) => a.ficheiro === FICHEIRO_CONFIG)!.depois;
    assert.match(config, /SEGREDOS_TIPO=openbao/);
    assert.match(config, /OPENBAO_ADDR=http:\/\/<openbao-na-leaseweb>:8200/);
    assert.match(config, /# AWS_REGION/);
    assert.ok(!p.alteracoes.some((a) => a.ficheiro === 'src/mais.ts'), 'mais.ts não muda: nada de forcePathStyle duplicado');
    assert.ok(p.fora.some((f) => /src\/mais\.ts:8: o cliente S3 é criado a partir de uma variável/.test(f)));
    assert.ok(p.fora.some((f) => /rds-signer/.test(f)));
    assert.ok(p.fora.some((f) => /pré-assinados/.test(f)));
    assert.ok(p.fora.some((f) => /Outros serviços da AWS no código \(src\/mais\.ts\)/.test(f)));
    assert.deepEqual(validarAlteracao(p, todos), []);
  });

  it('revisão: o Valkey leva senha no marcador; uma senha real num URL é recusada', async () => {
    const { dirApp } = await appLegada();
    await writeFile(join(dirApp, 'src', 'cache.ts'), 'export const url = process.env.CACHE_URL;\n');
    const usos = await encontrarUsosAws(dirApp);
    const p = await proporAlteracao(dirApp, usos);
    const config = p.alteracoes.find((a) => a.ficheiro === FICHEIRO_CONFIG)!;
    assert.match(config.depois, /VALKEY_URL=redis:\/\/:<senha>@<valkey-na-leaseweb>:6379/);
    const mau = { ...p, alteracoes: [{ ...config, depois: `${config.depois}X=redis://:abc123@h:6379\n` }] };
    assert.ok(validarAlteracao(mau, usos).some((x) => /parece ter um segredo/.test(x)));
  });

  it('a app tem de estar dentro do repo', async () => {
    const { dirApp } = await appLegada();
    const fora = await mkdtemp(join(tmpdir(), 'outro-repo-'));
    await assert.rejects(migrarCodigo(dirApp, { raizRepo: fora, id: 'x', testesOk: true }), /a app tem de estar dentro do repo/);
  });
});
