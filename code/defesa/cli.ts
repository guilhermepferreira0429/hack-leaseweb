// npm run dev:defesa -> só a defesa, sem migrador nem atacante: detetar pela API, pedir aprovação no Telegram,
// fechar, e ficar à escuta dos botões Desfazer e do /desfazer <id>. Útil para testar a peça sozinha;
// na demo corre tudo pelo orquestrador (npm run dev).
import { auditoria, carregarConfig, estado, telegram } from '@mwbe/shared';
import { corrigir } from './corrigir';
import { desfazer } from './desfazer';
import { detetar } from './detetar';
import { tratar } from './aprovar';
import { ligarDesfazer } from './ligar';

async function main(): Promise<void> {
  carregarConfig(['LSW_API_KEY', 'LSW_SG_GERIDOS']);
  const avisar = (t: string) => telegram.notificar(t);
  ligarDesfazer(telegram);
  telegram.aoResponder((pedidoId, decisao, quem) => {
    const p = estado.obterPedido(pedidoId);
    if (!p || p.estado !== 'pendente') return;
    const aprovado = decisao === 'aprovar';
    estado.mudarEstado(pedidoId, aprovado ? 'aprovado' : 'ignorado');
    auditoria.registar({ hora: new Date().toISOString(), pedidoId, tipo: aprovado ? 'aprovado' : 'ignorado', quem });
    if (aprovado) corrigir({ ...p, estado: 'aprovado' }, avisar).catch((e) => console.error('[defesa]', e instanceof Error ? e.message : e));
  });
  telegram.aoMensagemDoDono((_agente, texto) => {
    const m = texto.trim().match(/^\/desfazer(?:@\S+)?\s+(\S+)/);
    if (m) desfazer(m[1], avisar).catch((e) => avisar(`Não consegui desfazer ${m[1]}: ${e instanceof Error ? e.message : e}`));
  });
  const achados = await detetar();
  console.log(`[defesa] ${achados.length} achado(s) pela API`);
  for (const a of achados) await tratar(a);
  console.log('[defesa] à espera das decisões no Telegram (Ctrl+C para sair)');
}

main().catch((erro) => {
  console.error('[defesa]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
