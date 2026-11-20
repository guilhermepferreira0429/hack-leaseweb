// A IA escreve 3 frases em português simples sobre um achado. Só texto.
// A ação proposta NÃO vem da IA: vem de proporAcao() em corrigir.ts.
import type { Achado, ClienteOllama, Explicacao } from '@mwbe/shared';
import { naoImplementado } from '@mwbe/shared';

export const PROMPT_SISTEMA = [
  'És um assistente de segurança que explica problemas a pessoas sem formação técnica.',
  'Responde em português de Portugal, com exatamente 3 frases curtas:',
  '1) o que está exposto, 2) o que alguém mal-intencionado poderia fazer, 3) o que propomos fechar.',
  'Não uses jargão, não dês comandos, não inventes dados que não estejam no achado.',
].join(' ');

/** Pede a explicação ao Ollama e valida o formato (3 frases, tamanho máximo). */
export function explicar(ollama: ClienteOllama, achado: Achado): Promise<Explicacao> {
  return naoImplementado('explicar');
}

/** Texto de recurso se o Ollama falhar ou devolver lixo. A demo nunca pára por causa da IA. */
export function explicacaoDeRecurso(achado: Achado): Explicacao {
  return naoImplementado('explicacaoDeRecurso');
}

/** Parte a resposta do modelo em exatamente 3 frases, ou devolve undefined se não der. */
export function extrairTresFrases(texto: string): [string, string, string] | undefined {
  return naoImplementado('extrairTresFrases');
}
