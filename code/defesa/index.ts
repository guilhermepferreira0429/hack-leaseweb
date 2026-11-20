// Biblioteca da defesa. O painel importa daqui; o ponto de entrada é cli.ts.
// Ciclo: detetar -> explicar -> proporAcao -> pedirAprovacao.
// A resposta do humano chega ao painel (/webhook), que chama tratarResposta().
import type { Auditoria, ClienteLeaseweb, ClienteOllama, Config, RespostaHumana } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';
import type { CanalMensagens } from './aprovar';

export * from './detetar';
export * from './explicar';
export * from './aprovar';
export * from './corrigir';
export * from './desfazer';

export interface DependenciasDefesa {
  config: Config;
  leaseweb: ClienteLeaseweb;
  ollama: ClienteOllama;
  auditoria: Auditoria;
  canal: CanalMensagens;
}

/** Um ciclo de deteção: para cada achado novo, explica, propõe e pede aprovação. Não altera nada. */
export function cicloDefesa(deps: DependenciasDefesa): Promise<void> {
  return naoImplementado('cicloDefesa');
}

/**
 * Chamado pelo painel quando chega um clique válido (já com remetente autorizado):
 * aprovar -> aplicarAcao + avisarFechado (com botão Desfazer)
 * recusar -> regista 'recusado'
 * desfazer -> desfazer()
 */
export function tratarResposta(resposta: RespostaHumana, deps: DependenciasDefesa): Promise<void> {
  return naoImplementado('tratarResposta');
}
