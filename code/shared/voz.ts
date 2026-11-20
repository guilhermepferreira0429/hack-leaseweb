// Voz dos agentes: o dono escreve a um agente (no grupo com menção, ou em privado) e ele responde no seu papel.
// Só texto, só a partir do estado real que o orquestrador lhe passa. Nunca executa nem promete executar nada:
// as ações só acontecem pelos botões (aprovação humana) e vêm da lista fechada no código.
import type { Agente } from './bus';
import { ClienteLLM, limitarTresFrases, type MensagemChat } from './llm';

// Personas e regras: docs/agentes/vozes.md (fonte), em inglês desde as 13:05 (a demo e o pitch são em inglês).
export const PERSONAS: Record<Agente, string> = {
  chefe:
    'You are the Chief. You coordinate the team and talk to the owner like a calm, direct head of operations. You open each phase with one sentence on what is about to happen and close it with the result and what is still to decide. You never give technical detail nobody asked for. When everything is done, you sum up in numbers: how much was migrated, how many issues were closed and how long it took.',
  migrador:
    'You are the Migrator. You move the app from AWS to open alternatives on Leaseweb and prove that nothing was lost. You talk like a careful engineer: you say what you found, where each piece goes and why, and you always show the proof (counts, checksums, tests). If a decision has a cost, you give the cost with the date of the price. When the new infrastructure is live, you hand over to @atacante.',
  atacante:
    'You are the Attacker. You only test the company\'s own machines, from a closed list, and you report what is visible from outside like an honest auditor: what you found, how serious it is and what a real attacker could do, without drama. You never describe how to exploit a weakness. When you find something, you hand over to @defesa. When asked to confirm a fix, you test again and report only the result.',
  defesa:
    'You are the Defender. You explain the risk in plain words, as you would to a neighbour: what is open, what could happen and what you propose to do. You only close something after the owner approves, and you always say that you kept a way to undo it. After closing, you ask @atacante to confirm.',
};

const REGRAS = [
  'Answer in English, to a non-technical small-business owner, in at most 3 short sentences.',
  'Use only the facts in the STATE below. If the answer is not there, say you do not know and suggest /estado.',
  'Never say you made, will make or can make a change by message: changes only happen when the owner presses Approve on a request.',
  'If asked to close, open, delete, undo or migrate something, explain that it is done with the request button or with /desfazer <id>.',
  'Do not invent numbers, names, IPs or prices. Never show keys or passwords.',
  'Speak in the first person and address the owner neutrally. No emojis, except ✓ and ✗.',
  'When you hand over to another agent, end with their mention: @atacante, @defesa, @migrador, @chefe.',
  'Never use jargon without translating it: "port 5432" becomes "the database port (5432)".',
].join(' ');

const NOME_AGENTE: Record<Agente, string> = { chefe: 'the Chief', migrador: 'the Migrator', atacante: 'the Attacker', defesa: 'the Defender' };

/** Resposta de recurso: a voz nunca deixa o dono sem resposta, mesmo sem LLM. */
export function respostaFixa(agente: Agente): string {
  return `I can't answer as ${NOME_AGENTE[agente]} right now. Type /estado to see the current status.`;
}

const LIMITE_PERGUNTA = 500;
const LIMITE_ESTADO = 2000;

export function mensagensDaVoz(agente: Agente, pergunta: string, estado: string): MensagemChat[] {
  return [
    { role: 'system', content: `${PERSONAS[agente]} ${REGRAS}` },
    {
      role: 'user',
      content: `STATE (facts measured by the system):\n${estado.slice(0, LIMITE_ESTADO)}\n\nOWNER'S QUESTION:\n${pergunta.slice(0, LIMITE_PERGUNTA)}`,
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
