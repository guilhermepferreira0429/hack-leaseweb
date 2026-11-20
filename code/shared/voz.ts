// Voz dos agentes: o dono escreve a um agente (no grupo com menção, ou em privado) e ele responde no seu papel.
// Só texto, só a partir do estado real que o orquestrador lhe passa. Nunca executa nem promete executar nada:
// as ações só acontecem pelos botões (aprovação humana) e vêm da lista fechada no código.
import type { Agente } from './bus';
import { ClienteLLM, limitarTresFrases, type MensagemChat } from './llm';

export const PERSONAS: Record<Agente, string> = {
  chefe:
    'És o Chefe: coordenas a equipa de agentes e resumes. Respondes ao dono com o ponto da situação e as decisões que faltam.',
  migrador:
    'És o Migrador: tiras a app da AWS para alternativas abertas na Leaseweb (S3 para MinIO, RDS para PostgreSQL, SQS para RabbitMQ) e provas que os dados ficaram iguais.',
  atacante:
    'És o Atacante: testas só as máquinas da própria empresa, de uma lista fechada, e dizes o que conseguiste ver de fora. Nunca atacas mais nada.',
  defesa:
    'És a Defesa: explicas os riscos em português simples e fechas acessos só depois de o dono aprovar, guardando sempre como voltar atrás.',
};

const REGRAS = [
  'Responde em português de Portugal, a uma pessoa sem formação técnica, em no máximo 3 frases curtas.',
  'Usa só os factos do ESTADO abaixo. Se a resposta não estiver lá, diz que não sabes e sugere /estado.',
  'Nunca digas que fizeste, vais fazer ou podes fazer uma alteração por mensagem: as alterações só acontecem quando o dono carrega em Aprovar num pedido.',
  'Se te pedirem para fechar, abrir, apagar, desfazer ou migrar algo, explica que isso se faz pelo botão do pedido ou por /desfazer <id>.',
  'Não inventes números, nomes, IPs nem preços. Não mostres chaves nem palavras-passe.',
].join(' ');

/** Resposta de recurso: a voz nunca deixa o dono sem resposta, mesmo sem LLM. */
export function respostaFixa(agente: Agente): string {
  return `Agora não consigo responder como ${agente}. Para ver o ponto da situação, escreva /estado.`;
}

const LIMITE_PERGUNTA = 500;
const LIMITE_ESTADO = 2000;

export function mensagensDaVoz(agente: Agente, pergunta: string, estado: string): MensagemChat[] {
  return [
    { role: 'system', content: `${PERSONAS[agente]} ${REGRAS}` },
    {
      role: 'user',
      content: `ESTADO (factos medidos pelo sistema):\n${estado.slice(0, LIMITE_ESTADO)}\n\nPERGUNTA DO DONO:\n${pergunta.slice(0, LIMITE_PERGUNTA)}`,
    },
  ];
}

let clientePorDefeito: ClienteLLM | undefined;

/** Responde no papel do agente. Nunca lança: sem LLM, com erro ou com resposta inválida, devolve respostaFixa. */
export async function responderComoAgente(agente: Agente, pergunta: string, estado: string, cliente?: ClienteLLM): Promise<string> {
  const llm = cliente ?? (clientePorDefeito ??= ClienteLLM.doEnv());
  if (!llm.configurado) return respostaFixa(agente);
  try {
    const { texto } = await llm.conversar(mensagensDaVoz(agente, pergunta, estado), 0.3);
    return limitarTresFrases(texto) ?? respostaFixa(agente);
  } catch (erro) {
    console.warn('[voz]', erro instanceof Error ? erro.message : erro);
    return respostaFixa(agente);
  }
}
