// O LLM escreve 3 frases em português simples sobre um achado. Só texto.
// A ação proposta NÃO vem do LLM: vem de proporAcao() em corrigir.ts.
// Se o LLM falhar (sem fornecedor, erro, 20 s de timeout ou formato errado), usa textoFixo().
import type { Achado, ClienteLLM, Explicacao } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export const PROMPT_SISTEMA = [
  'És um assistente de segurança que explica problemas a pessoas sem formação técnica.',
  'Responde em português de Portugal, com exatamente 3 frases curtas:',
  '1) o que está exposto, 2) o que alguém mal-intencionado poderia fazer, 3) o que propomos fechar.',
  'Não uses jargão, não dês comandos, não inventes dados que não estejam no achado.',
].join(' ');

/**
 * Pede a explicação ao LLM e valida o formato (3 frases, tamanho máximo).
 * Nunca lança: em qualquer falha devolve { origem: 'fixo', frases: textoFixo(achado) }.
 */
export function explicar(llm: ClienteLLM, achado: Achado): Promise<Explicacao> {
  return naoImplementado('explicar');
}

/** Parte a resposta do modelo em exatamente 3 frases, ou devolve undefined se não der. */
export function extrairTresFrases(texto: string): [string, string, string] | undefined {
  return naoImplementado('extrairTresFrases');
}
