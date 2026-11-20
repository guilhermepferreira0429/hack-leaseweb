// Decisor de destino: self-hosted na VM da Leaseweb ou serviço gerido europeu. As regras decidem; a IA só explica.
export { decidirDestino, servicosDoPlano, ordenarGeridos, REGRAS, type CapacidadeVm, type Criticidade, type Decisao, type EntradaDecisor, type EntradaServico } from './decidir';
export { mensagemDestino, textoPreco } from './mensagem';
export type { ServicoDestino } from './tabelas';
