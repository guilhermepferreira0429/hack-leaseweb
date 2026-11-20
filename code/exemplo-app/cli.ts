// npm run dev:exemplo [-- --semear 20]
// Corre a app contra o ambiente definido nas variáveis (LocalStack ou Leaseweb).
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: criar adaptadores, prepararEsquema, semear se --semear, imprimir contagens
  naoImplementado('exemplo-app/cli main');
}

main().catch((erro) => {
  console.error('[exemplo-app]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
