// npm run dev:defesa -> só a defesa: detetar pela API, tratar cada achado e esperar pelo Telegram.
// Útil para testar a peça sozinha; na demo corre tudo pelo orquestrador (npm run dev).
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, telegram.aoResponder -> corrigir, telegram.aoDesfazer -> desfazer, detetar, tratar
  naoImplementado('defesa/cli main');
}

main().catch((erro) => {
  console.error('[defesa]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
