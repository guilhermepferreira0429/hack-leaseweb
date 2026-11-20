// npm run dev:migrador [-- --so-analisar]
// Corre o migrador sozinho (sem pedir aprovação); na demo corre pelo orquestrador (npm run dev).
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, analisar('code/exemplo-app'), migrarS3, verificar
  naoImplementado('migrador/cli main');
}

main().catch((erro) => {
  console.error('[migrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
