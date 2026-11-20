// npm run dev:defesa -> corre um ciclo de deteção e envia pedidos de aprovação.
// Opções previstas: --vigiar (repete a cada N segundos).
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, criar clientes, criarCanal, cicloDefesa (uma vez ou em ciclo com --vigiar)
  naoImplementado('defesa/cli main');
}

main().catch((erro) => {
  console.error('[defesa]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
