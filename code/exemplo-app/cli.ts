// npm run dev:exemplo [-- --semear 20]
// Corre a app contra o ambiente definido nas variáveis (LocalStack ou Leaseweb).
import { carregarEnvLocal } from './adaptadores';
import {
  criarDependencias,
  fecharDependencias,
  listarEncomendas,
  prepararEsquema,
  processarEventos,
  PREFIXO_FATURAS,
  semear,
} from './app';

function argNumero(nome: string): number | undefined {
  const i = process.argv.indexOf(nome);
  if (i === -1) return undefined;
  const n = Number(process.argv[i + 1] ?? '10');
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(`${nome} espera um número entre 1 e 1000`);
  return n;
}

async function main(): Promise<void> {
  carregarEnvLocal();
  const quantidade = argNumero('--semear');
  const deps = criarDependencias();
  try {
    console.log(`[exemplo-app] armazenamento: ${deps.armazenamento.descricao}`);
    await prepararEsquema(deps);
    if (quantidade) {
      const criadas = await semear(deps, quantidade);
      console.log(`[exemplo-app] semeadas ${criadas.length} encomendas com fatura`);
      // Esvazia a fila dos eventos acabados de publicar, como faria o serviço que os consome.
      let consumidos = 0;
      while (consumidos < criadas.length) {
        const n = (await processarEventos(deps, 10)).length;
        if (n === 0) break;
        consumidos += n;
      }
      console.log(`[exemplo-app] eventos encomenda-criada consumidos: ${consumidos}`);
    }
    const encomendas = await listarEncomendas(deps);
    const faturas = await deps.armazenamento.listar(PREFIXO_FATURAS);
    console.log(`[exemplo-app] encomendas na base de dados: ${encomendas.length}; faturas no armazenamento: ${faturas.length}`);
  } finally {
    await fecharDependencias(deps);
  }
}

main().catch((erro) => {
  console.error('[exemplo-app]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
