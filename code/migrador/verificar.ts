// Mesmos testes da exemplo-app dos dois lados: antes (LocalStack) e depois (MinIO).
// Corre os testes de code/exemplo-app/testes num processo à parte, com as variáveis de cada ambiente.
// VERIFICACAO_ESTRITA=1: com a infraestrutura em baixo ou sem dados, os testes falham em vez de saltar.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { envDaApp, lerAmbienteMigrador, RAIZ_REPO } from './ambiente';
import { sondarArmazenamento } from './migrar-dados';

const FICHEIRO_TESTES = join(RAIZ_REPO, 'code', 'exemplo-app', 'testes', 'app.test.ts');
const LIMITE_MS = 120_000;

export interface ResultadoTestes {
  ok: boolean;
  /** Linhas "ok"/"not ok" e motivos de falha, para log. Sem variáveis de ambiente. */
  resumo: string;
}

function correrTestes(envExtra: Record<string, string>): Promise<ResultadoTestes> {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', FICHEIRO_TESTES], {
      cwd: RAIZ_REPO,
      env: { ...process.env, ...envExtra, VERIFICACAO_ESTRITA: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: LIMITE_MS,
    });
    let saida = '';
    filho.stdout.on('data', (b: Buffer) => (saida += b.toString()));
    filho.stderr.on('data', (b: Buffer) => (saida += b.toString()));
    const fim = (ok: boolean, extra = ''): void => {
      const linhas = saida
        .split(/\r?\n/)
        .filter((l) => /^\s*(not ok|ok) \d+ - /.test(l) || /^\s*(error|# (pass|fail)):?/.test(l))
        .map((l) => l.trim());
      resolver({ ok, resumo: [...linhas, extra].filter(Boolean).join('\n') });
    };
    filho.on('error', (erro) => fim(false, `não arrancou: ${erro.message}`));
    filho.on('close', (codigo, sinal) => fim(codigo === 0, sinal ? `terminado por ${sinal} (limite ${LIMITE_MS / 1000} s)` : ''));
  });
}

/** Versão com o resumo de cada lado (para o CLI e logs). */
export async function verificarDetalhado(): Promise<{ antes: ResultadoTestes; depois: ResultadoTestes }> {
  await sondarArmazenamento();
  const amb = lerAmbienteMigrador();
  // Em sequência: os dois lados partilham a base de dados e a fila.
  const antes = await correrTestes(envDaApp(amb.origem, amb.bucket));
  const depois = await correrTestes(envDaApp(amb.destino, amb.bucket));
  return { antes, depois };
}

export async function verificar(): Promise<{ antes: boolean; depois: boolean }> {
  const r = await verificarDetalhado();
  return { antes: r.antes.ok, depois: r.depois.ok };
}
