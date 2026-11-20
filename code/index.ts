// Orquestrador: um só processo Node no cérebro (npm run dev).
// Encadeia: migrador -> atacante -> defesa, com o chefe a resumir. Os agentes falam pelo bus
// (shared/bus.ts) e cada um publica a sua fala no grupo "Direção" com o seu bot.
//
//  1. carregarConfig; iniciarPainel(PORT)
//  2. telegram.aoResponder: aprovar -> corrigir(pedido); ignorar -> estado 'ignorado'
//     telegram.aoMensagemDoDono: /estado -> chefe.estadoAtual; /desfazer <id> -> desfazer
//  3. migrador.analisar -> Pedido { acao: migrar s3 } -> aprovação -> migrarS3 -> verificar
//  4. bus: migrador -> atacante "infraestrutura nova no ar" -> reconhecer(ALVOS_PERMITIDOS)
//  5. bus: atacante -> defesa achados; defesa.detetar() (API) + correlacionar -> tratar cada um
//  6. depois de corrigir: atacante volta a confirmar; chefe.resumir
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  naoImplementado('orquestrador main');
}

main().catch((erro) => {
  console.error('[orquestrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
