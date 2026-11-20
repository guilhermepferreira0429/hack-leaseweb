// Segredos e configuração da app, nos dois lados:
//   SEGREDOS_TIPO=aws (por omissão): Secrets Manager e SSM Parameter Store no LocalStack (LOCALSTACK_ENDPOINT)
//   SEGREDOS_TIPO=openbao: OpenBao na Leaseweb (OPENBAO_ADDR, OPENBAO_TOKEN), KV v2 em secret/
// Nomes: "encomendas/prod/x" é um segredo do Secrets Manager; "/encomendas/prod/x" é um parâmetro do SSM.
// Mapeamento no OpenBao (o mesmo do migrador e da seed):
//   secret/data/aws/secretsmanager/<nome>  e  secret/data/aws/ssm/<caminho sem a / inicial>, data { valor, tipo }
// REGRA: nenhum valor sai daqui para logs, erros ou testes. As mensagens de erro só têm nomes.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export type TipoSegredos = 'aws' | 'openbao';

export interface Segredos {
  /** Valor exato (string). Lança se não existir, sem incluir o valor na mensagem. */
  ler(nome: string): Promise<string>;
  /** Onde está a ler (tipo e endereço), sem token. */
  readonly descricao: string;
  fechar(): Promise<void>;
}

/** Caminho no KV v2 do OpenBao para um nome do Secrets Manager ou do SSM. */
export function caminhoOpenBao(nome: string): string {
  const [origem, caminho] = nome.startsWith('/') ? ['ssm', nome.slice(1)] : ['secretsmanager', nome];
  return `aws/${origem}/${caminho.split('/').map(encodeURIComponent).join('/')}`;
}

export function lerSegredosConfig(env: NodeJS.ProcessEnv = process.env): {
  tipo: TipoSegredos;
  endpoint: string;
  token?: string;
  regiao: string;
} {
  const v = (nome: string): string | undefined => env[nome]?.trim() || undefined;
  const tipo = (v('SEGREDOS_TIPO') ?? 'aws').toLowerCase();
  if (tipo !== 'aws' && tipo !== 'openbao') throw new Error(`Unknown SEGREDOS_TIPO: ${tipo} (use aws or openbao)`);
  const regiao = v('AWS_REGION') ?? 'us-east-1';
  if (tipo === 'aws') return { tipo, endpoint: v('LOCALSTACK_ENDPOINT') ?? 'http://127.0.0.1:4566', regiao };
  const token = v('OPENBAO_TOKEN');
  if (!token) throw new Error('SEGREDOS_TIPO=openbao but OPENBAO_TOKEN is not set in .env');
  return { tipo, endpoint: (v('OPENBAO_ADDR') ?? 'http://127.0.0.1:8200').replace(/\/+$/, ''), token, regiao };
}

export function criarSegredos(env: NodeJS.ProcessEnv = process.env): Segredos {
  const c = lerSegredosConfig(env);
  if (c.tipo === 'openbao') {
    return {
      descricao: `openbao ${c.endpoint}`,
      async ler(nome) {
        let r: Response;
        try {
          r = await fetch(`${c.endpoint}/v1/secret/data/${caminhoOpenBao(nome)}`, {
            headers: { 'X-Vault-Token': c.token! },
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          throw new Error(`OpenBao is not responding at ${c.endpoint}`);
        }
        if (r.status === 404) throw new Error(`Secret ${nome} not found in OpenBao`);
        if (r.status === 403) throw new Error('OpenBao rejected the token');
        if (!r.ok) throw new Error(`OpenBao returned ${r.status} reading ${nome}`);
        const corpo = (await r.json()) as { data?: { data?: { valor?: unknown } } };
        const valor = corpo.data?.data?.valor;
        if (typeof valor !== 'string') throw new Error(`Secret ${nome} has no "valor" field in OpenBao`);
        return valor;
      },
      async fechar() {},
    };
  }

  const credenciais = { accessKeyId: 'test', secretAccessKey: 'test' }; // convenção do LocalStack, não é segredo
  const sm = new SecretsManagerClient({ endpoint: c.endpoint, region: c.regiao, credentials: credenciais, maxAttempts: 2 });
  const ssm = new SSMClient({ endpoint: c.endpoint, region: c.regiao, credentials: credenciais, maxAttempts: 2 });
  return {
    descricao: `aws ${c.endpoint}`,
    async ler(nome) {
      try {
        if (nome.startsWith('/')) {
          const r = await ssm.send(new GetParameterCommand({ Name: nome, WithDecryption: true }));
          if (typeof r.Parameter?.Value !== 'string') throw new Error('no value');
          return r.Parameter.Value;
        }
        const r = await sm.send(new GetSecretValueCommand({ SecretId: nome }));
        if (typeof r.SecretString === 'string') return r.SecretString;
        if (r.SecretBinary) return Buffer.from(r.SecretBinary).toString('base64');
        throw new Error('no value');
      } catch (erro) {
        // Só o nome e o tipo de erro; nunca o corpo da resposta.
        const tipo = (erro as { name?: string }).name ?? 'erro';
        throw new Error(`Could not read ${nome} on AWS (${tipo})`);
      }
    },
    async fechar() {
      sm.destroy();
      ssm.destroy();
    },
  };
}

/** Segredo que a app lê ao arrancar (semeado pela seed: npm run seed). */
export const SEGREDO_PAGAMENTOS = 'encomendas/prod/api-pagamentos';

export interface ConfiguracaoPagamentos {
  fornecedor: string;
  endpoint: string;
  /** Só para usar em chamadas; nunca para escrever. */
  apiKey: string;
}

/** Configuração de arranque da app: o fornecedor de pagamentos e a chave, lidos dos segredos. */
export async function carregarConfiguracao(segredos: Segredos): Promise<ConfiguracaoPagamentos> {
  let dados: Partial<ConfiguracaoPagamentos>;
  try {
    dados = JSON.parse(await segredos.ler(SEGREDO_PAGAMENTOS)) as Partial<ConfiguracaoPagamentos>;
  } catch (erro) {
    if (erro instanceof SyntaxError) throw new Error(`${SEGREDO_PAGAMENTOS} is not valid JSON`);
    throw erro;
  }
  for (const campo of ['fornecedor', 'endpoint', 'apiKey'] as const) {
    if (typeof dados[campo] !== 'string' || dados[campo] === '') throw new Error(`${SEGREDO_PAGAMENTOS} is missing the ${campo} field`);
  }
  return dados as ConfiguracaoPagamentos;
}
