// npm run dev:migrador [-- --so-analisar]
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, Auditoria, migrar(config, auditoria, { soAnalisar: process.argv.includes('--so-analisar') })
  naoImplementado('migrador/cli main');
}

main().catch((erro) => {
  console.error('[migrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
