// migrarSegredos com segredos temporários (Secrets Manager e SSM no LocalStack -> OpenBao), apagados no fim.
// Também prova a regra: nenhum valor aparece no resultado (só nomes e hashes).
// Saltado se o LocalStack (secretsmanager, ssm) ou o OpenBao não estiverem no ar, ou sem OPENBAO_TOKEN.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { DeleteParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { carregarEnv } from '../ambiente';
import { migrarSegredosDetalhado } from '../migrar-segredos';

carregarEnv();
const TOKEN = process.env.OPENBAO_TOKEN?.trim() ?? '';
const BAO = (process.env.OPENBAO_ADDR?.trim() || 'http://127.0.0.1:8200').replace(/\/+$/, '');
const LOCALSTACK = process.env.LOCALSTACK_ENDPOINT?.trim() || 'http://127.0.0.1:4566';
const cred = { accessKeyId: 'test', secretAccessKey: 'test' };
const sm = new SecretsManagerClient({ endpoint: LOCALSTACK, region: 'us-east-1', credentials: cred, maxAttempts: 1 });
const ssm = new SSMClient({ endpoint: LOCALSTACK, region: 'us-east-1', credentials: cred, maxAttempts: 1 });

const ID = `migrador-teste-${randomBytes(4).toString('hex')}`;
// Valores gerados no teste: nunca são escritos; só se procuram no resultado para provar que não aparecem.
const VALOR_SM = JSON.stringify({ password: `x-${randomBytes(12).toString('hex')}`, nota: 'Café — Ç "aspas"' });
const VALOR_SSM = `y-${randomBytes(12).toString('hex')}`;
const NOME_SM = `${ID}/base-dados`;
const NOME_SSM = `/${ID}/db/password`;
const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

async function sondar(): Promise<string | false> {
  if (!TOKEN) return 'OPENBAO_TOKEN não definido';
  try {
    await sm.send(new ListSecretsCommand({ MaxResults: 1 }), { abortSignal: AbortSignal.timeout(3000) });
    const r = await fetch(`${BAO}/v1/sys/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return `OpenBao respondeu ${r.status}`;
    return false;
  } catch (erro) {
    return `LocalStack (secretsmanager) ou OpenBao em baixo: ${erro instanceof Error ? erro.message : erro}`;
  }
}

const salto = await sondar();

async function apagarNoBao(caminho: string): Promise<void> {
  await fetch(`${BAO}/v1/secret/metadata/${caminho}`, { method: 'DELETE', headers: { 'X-Vault-Token': TOKEN } }).catch(() => {});
}

describe('migrador: migrarSegredos', { skip: salto }, () => {
  before(async () => {
    await sm.send(new CreateSecretCommand({ Name: NOME_SM, SecretString: VALOR_SM }));
    await ssm.send(new PutParameterCommand({ Name: NOME_SSM, Value: VALOR_SSM, Type: 'SecureString' }));
  });

  after(async () => {
    await sm.send(new DeleteSecretCommand({ SecretId: NOME_SM, ForceDeleteWithoutRecovery: true })).catch(() => {});
    await ssm.send(new DeleteParameterCommand({ Name: NOME_SSM })).catch(() => {});
    await apagarNoBao(`aws/secretsmanager/${NOME_SM}`);
    await apagarNoBao(`aws/ssm/${NOME_SSM.slice(1)}`);
    sm.destroy();
    ssm.destroy();
  });

  it('copia Secrets Manager e SSM para o OpenBao com sha256 iguais', async () => {
    const r = await migrarSegredosDetalhado({ contem: ID });
    const meus = r.segredos;
    assert.deepEqual(
      meus.map((s) => [s.origem, s.nome, s.tipo]),
      [['secretsmanager', NOME_SM, 'SecretString'], ['ssm', NOME_SSM, 'SecureString']],
    );
    assert.ok(meus[0]!.shaOrigem === sha(VALOR_SM) && meus[0]!.shaDestino === sha(VALOR_SM), 'sha256 do segredo');
    assert.ok(meus[1]!.shaOrigem === sha(VALOR_SSM) && meus[1]!.shaDestino === sha(VALOR_SSM), 'sha256 do parâmetro');
    assert.equal(r.iguais, true);
  });

  it('nenhum valor aparece no resultado, só nomes e hashes', async () => {
    const texto = JSON.stringify(await migrarSegredosDetalhado({ contem: ID }));
    assert.ok(!texto.includes(VALOR_SSM), 'o valor do parâmetro não aparece');
    assert.ok(!texto.includes(JSON.parse(VALOR_SM).password), 'a password do segredo não aparece');
  });

  it('o OpenBao fica com o mapeamento combinado (secret/data/aws/...) e data { valor, tipo }', async () => {
    const r = await fetch(`${BAO}/v1/secret/data/aws/ssm/${NOME_SSM.slice(1)}`, { headers: { 'X-Vault-Token': TOKEN } });
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as { data: { data: { valor: string; tipo: string } } };
    assert.ok(corpo.data.data.valor === VALOR_SSM, 'valor igual (comparado, não mostrado)');
    assert.equal(corpo.data.data.tipo, 'SecureString');
  });
});
