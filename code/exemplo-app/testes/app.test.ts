// Os mesmos testes correm antes (AWS/LocalStack) e depois (Leaseweb/MinIO). Só mudam as variáveis de ambiente:
//   sem ARMAZENAMENTO_*            -> LocalStack (LOCALSTACK_ENDPOINT)
//   ARMAZENAMENTO_ENDPOINT=MinIO   -> Leaseweb (com ARMAZENAMENTO_ACCESS_KEY/SECRET_KEY)
// Sem a infraestrutura no ar (npm run infra:up) os testes são saltados, para o `npm test` de quem
// não tem Docker não ficar vermelho. Com VERIFICACAO_ESTRITA=1 (o migrador usa-o) nada é saltado.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { carregarEnvLocal } from '../adaptadores';
import {
  apagarEncomenda,
  criarDependencias,
  fecharDependencias,
  listarEncomendas,
  obterEncomenda,
  prepararEsquema,
  processarEventos,
  PREFIXO_FATURAS,
  registarEncomenda,
  sha256Hex,
} from '../app';
import type { Dependencias, Encomenda } from '../app';

carregarEnvLocal();
const ESTRITA = process.env.VERIFICACAO_ESTRITA === '1';
const PREFIXO_CLIENTE_TESTE = 'teste-';

/** null se a infraestrutura responde; senão, o motivo. */
async function sondar(): Promise<string | null> {
  let deps: Dependencias | undefined;
  try {
    deps = criarDependencias();
    const d = deps;
    const tempo = new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('sem resposta em 8 s')), 8000).unref());
    await Promise.race([Promise.all([d.baseDados.consultar('SELECT 1'), d.armazenamento.listar(PREFIXO_FATURAS)]), tempo]);
    return null;
  } catch (erro) {
    // Um bucket que ainda não existe não é falta de infraestrutura: o adaptador cria-o ao guardar.
    const estado = (erro as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (estado === 404) return null;
    return erro instanceof Error ? erro.message : String(erro);
  } finally {
    if (deps) await fecharDependencias(deps);
  }
}

const motivo = ESTRITA ? null : await sondar();
const salto = motivo ? `infraestrutura em baixo (npm run infra:up): ${motivo}` : false;

describe('exemplo-app (contrato igual em AWS e Leaseweb)', { skip: salto }, () => {
  let deps: Dependencias;
  const criadas: Encomenda[] = [];

  before(async () => {
    deps = criarDependencias();
    await prepararEsquema(deps);
  });

  after(async () => {
    if (!deps) return;
    for (const e of criadas) await apagarEncomenda(deps, e).catch(() => {});
    await fecharDependencias(deps);
  });

  const nova = async (): Promise<Encomenda> => {
    const fatura = Buffer.concat([Buffer.from('FATURA DE TESTE\n'), randomBytes(512)]);
    const e = await registarEncomenda(deps, { cliente: `${PREFIXO_CLIENTE_TESTE}${randomUUID()}`, totalCentimos: 1234, fatura });
    criadas.push(e);
    return e;
  };

  it('guarda e lê uma fatura no armazenamento com o mesmo sha256', async () => {
    const chave = `testes/${randomUUID()}.bin`;
    const conteudo = randomBytes(64 * 1024);
    await deps.armazenamento.guardar(chave, conteudo, 'application/octet-stream');
    try {
      const lido = await deps.armazenamento.ler(chave);
      assert.equal(sha256Hex(lido), sha256Hex(conteudo));
      assert.ok((await deps.armazenamento.listar('testes/')).includes(chave), 'a chave aparece na listagem');
    } finally {
      await deps.armazenamento.apagar(chave);
    }
  });

  it('regista uma encomenda e lê-a da base de dados', async () => {
    const e = await nova();
    const lida = await obterEncomenda(deps, e.id);
    assert.deepEqual(lida, e);
    const fatura = await deps.armazenamento.ler(e.faturaChave);
    assert.equal(sha256Hex(fatura), e.faturaSha256, 'a fatura guardada é a da encomenda');
    assert.equal(await obterEncomenda(deps, randomUUID()), undefined);
  });

  it('publica o evento encomenda-criada e consome-o da fila', async () => {
    const e = await nova();
    const vistos: string[] = [];
    for (let tentativa = 0; tentativa < 10 && !vistos.includes(e.id); tentativa++) {
      vistos.push(...(await processarEventos(deps, 10)));
    }
    assert.ok(vistos.includes(e.id), `o evento da encomenda ${e.id} chegou à fila`);
  });

  it('a contagem de encomendas semeadas bate certo depois da migração', async (t) => {
    const semeadas = (await listarEncomendas(deps)).filter((e) => !e.cliente.startsWith(PREFIXO_CLIENTE_TESTE));
    if (semeadas.length === 0) {
      if (ESTRITA) assert.fail('não há encomendas semeadas: npm run dev:exemplo -- --semear 20');
      t.skip('sem encomendas semeadas (npm run dev:exemplo -- --semear 20)');
      return;
    }
    // Cada encomenda da base de dados tem a sua fatura no armazenamento, com o sha256 de quando foi criada.
    const faturas = new Set(await deps.armazenamento.listar(PREFIXO_FATURAS));
    const emFalta = semeadas.filter((e) => !faturas.has(e.faturaChave)).map((e) => e.faturaChave);
    assert.deepEqual(emFalta, [], `faltam ${emFalta.length} de ${semeadas.length} faturas em ${deps.armazenamento.descricao}`);
    for (const e of semeadas) {
      assert.equal(sha256Hex(await deps.armazenamento.ler(e.faturaChave)), e.faturaSha256, `sha256 de ${e.faturaChave}`);
    }
  });
});
