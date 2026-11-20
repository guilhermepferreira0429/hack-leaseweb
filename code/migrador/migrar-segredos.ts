// Secrets Manager + SSM Parameter Store (LocalStack) -> OpenBao (Leaseweb), KV v2 em secret/.
//   Secrets Manager <nome> -> secret/data/aws/secretsmanager/<nome>
//   SSM /<caminho>         -> secret/data/aws/ssm/<caminho>
//   data: { valor: <string exata>, tipo: SecretString | SecretBinary (base64) | String | StringList | SecureString }
// Prova: contagem e sha256 de cada valor dos dois lados (o OpenBao relê-se depois de escrito).
// REGRA: nenhum valor sai desta função: nem em logs, nem em erros, nem no resultado. Só nomes e hashes.
import { createHash } from 'node:crypto';
import {
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GetParametersByPathCommand, type GetParametersByPathCommandOutput, SSMClient } from '@aws-sdk/client-ssm';
import { carregarEnv } from './ambiente';

export interface ChecksumSegredo {
  origem: 'secretsmanager' | 'ssm';
  nome: string;
  tipo: string;
  shaOrigem: string;
  shaDestino: string;
}

interface Segredo {
  origem: 'secretsmanager' | 'ssm';
  nome: string;
  tipo: string;
  valor: string;
}

const sha = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');

/** O mesmo mapeamento que a exemplo-app (code/exemplo-app/segredos.ts) e a seed usam. */
function caminho(s: { origem: 'secretsmanager' | 'ssm'; nome: string }): string {
  const resto = s.origem === 'ssm' ? s.nome.replace(/^\/+/, '') : s.nome;
  return `aws/${s.origem}/${resto.split('/').map(encodeURIComponent).join('/')}`;
}

function lerConfig(): { localstack: string; regiao: string; bao: string; token: string } {
  carregarEnv();
  const v = (nome: string): string | undefined => process.env[nome]?.trim() || undefined;
  const token = v('OPENBAO_TOKEN');
  if (!token) throw new Error('OPENBAO_TOKEN não está definido no .env');
  return {
    localstack: v('LOCALSTACK_ENDPOINT') ?? 'http://127.0.0.1:4566',
    regiao: v('AWS_REGION') ?? 'us-east-1',
    bao: (v('OPENBAO_ADDR') ?? 'http://127.0.0.1:8200').replace(/\/+$/, ''),
    token,
  };
}

async function lerOrigem(sm: SecretsManagerClient, ssm: SSMClient, localstack: string): Promise<Segredo[]> {
  const segredos: Segredo[] = [];
  try {
    let token: string | undefined;
    do {
      const r = await sm.send(new ListSecretsCommand({ NextToken: token, MaxResults: 100 }), { abortSignal: AbortSignal.timeout(8000) });
      for (const s of r.SecretList ?? []) {
        if (!s.Name) continue;
        const v = await sm.send(new GetSecretValueCommand({ SecretId: s.Name }));
        if (typeof v.SecretString === 'string') {
          segredos.push({ origem: 'secretsmanager', nome: s.Name, tipo: 'SecretString', valor: v.SecretString });
        } else if (v.SecretBinary) {
          segredos.push({ origem: 'secretsmanager', nome: s.Name, tipo: 'SecretBinary', valor: Buffer.from(v.SecretBinary).toString('base64') });
        }
      }
      token = r.NextToken;
    } while (token);

    token = undefined;
    do {
      const r: GetParametersByPathCommandOutput = await ssm.send(
        new GetParametersByPathCommand({ Path: '/', Recursive: true, WithDecryption: true, NextToken: token }),
      );
      for (const p of r.Parameters ?? []) {
        if (p.Name && typeof p.Value === 'string') {
          segredos.push({ origem: 'ssm', nome: p.Name, tipo: p.Type ?? 'String', valor: p.Value });
        }
      }
      token = r.NextToken;
    } while (token);
  } catch (erro) {
    // Só o tipo de erro: o corpo de uma resposta da AWS pode trazer valores.
    const nome = (erro as { name?: string }).name ?? 'erro';
    if (/TimeoutError|AbortError|ECONNREFUSED/.test(`${nome} ${(erro as { code?: string }).code ?? ''}`)) {
      throw new Error(`Secrets Manager/SSM (LocalStack) não responde em ${localstack}`);
    }
    throw new Error(`Não consegui ler os segredos da AWS (${nome})`);
  }
  return segredos.sort((a, b) => `${a.origem}${a.nome}`.localeCompare(`${b.origem}${b.nome}`));
}

/** Pedido ao OpenBao. Os erros nunca incluem o corpo do pedido nem da resposta. */
async function bao(cfg: ReturnType<typeof lerConfig>, metodo: 'GET' | 'POST', rota: string, corpo?: unknown): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(`${cfg.bao}/v1/${rota}`, {
      method: metodo,
      headers: { 'X-Vault-Token': cfg.token, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`OpenBao não responde em ${cfg.bao}`);
  }
  if (r.status === 403) throw new Error('OpenBao recusou o token (OPENBAO_TOKEN)');
  if (r.status === 404 && metodo === 'GET') return undefined;
  if (!r.ok) throw new Error(`OpenBao respondeu ${r.status} em ${metodo} ${rota.split('/').slice(0, 3).join('/')}/…`);
  return r.status === 204 ? undefined : r.json();
}

/**
 * Versão com o detalhe por segredo (nomes e hashes, nunca valores), para o CLI e o painel.
 * `opcoes.contem`: só os nomes que contêm este texto (os testes usam-no); por omissão, todos.
 */
export async function migrarSegredosDetalhado(opcoes: { contem?: string } = {}): Promise<{ segredos: ChecksumSegredo[]; iguais: boolean }> {
  const cfg = lerConfig();
  const credenciais = { accessKeyId: 'test', secretAccessKey: 'test' }; // convenção do LocalStack, não é segredo
  const sm = new SecretsManagerClient({ endpoint: cfg.localstack, region: cfg.regiao, credentials: credenciais, maxAttempts: 2 });
  const ssm = new SSMClient({ endpoint: cfg.localstack, region: cfg.regiao, credentials: credenciais, maxAttempts: 2 });
  try {
    // OpenBao primeiro: se não estiver no ar, nem se lê nada da origem.
    await bao(cfg, 'GET', 'sys/health');
    const origem = (await lerOrigem(sm, ssm, cfg.localstack)).filter((s) => !opcoes.contem || s.nome.includes(opcoes.contem));
    if (origem.length === 0) throw new Error('Não há segredos no Secrets Manager nem no SSM: nada para migrar (npm run seed)');

    const resultado: ChecksumSegredo[] = [];
    for (const s of origem) {
      const rota = `secret/data/${caminho(s)}`;
      await bao(cfg, 'POST', rota, { data: { valor: s.valor, tipo: s.tipo } });
      const lido = (await bao(cfg, 'GET', rota)) as { data?: { data?: { valor?: unknown } } } | undefined;
      const valor = lido?.data?.data?.valor;
      resultado.push({
        origem: s.origem,
        nome: s.nome,
        tipo: s.tipo,
        shaOrigem: sha(s.valor),
        shaDestino: typeof valor === 'string' ? sha(valor) : '(em falta no OpenBao)',
      });
    }
    return { segredos: resultado, iguais: resultado.every((r) => r.shaOrigem === r.shaDestino) };
  } finally {
    sm.destroy();
    ssm.destroy();
  }
}

/** Copia os segredos do Secrets Manager e do SSM para o OpenBao e compara contagem e sha256 dos valores. */
export async function migrarSegredos(): Promise<{ segredos: number; iguais: boolean }> {
  const r = await migrarSegredosDetalhado();
  return { segredos: r.segredos.length, iguais: r.iguais };
}
