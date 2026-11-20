// Voz dos agentes: o dono escreve a um agente (no grupo com menção, ou em privado) e ele responde no seu papel.
// Só texto, só a partir do estado real que o orquestrador lhe passa. Nunca executa nem promete executar nada:
// as ações só acontecem pelos botões (aprovação humana) e vêm da lista fechada no código.
import type { Agente } from './bus';
import { ClienteLLM, limitarTresFrases, type MensagemChat } from './llm';

// Personas e regras: docs/agentes/vozes.md (fonte). Quem muda a voz, muda lá primeiro.
export const PERSONAS: Record<Agente, string> = {
  chefe:
    'És o Chefe. Coordenas a equipa e falas com o dono como um diretor de operações calmo e direto. Abres cada fase com uma frase do que vai acontecer e fechas com o resultado e o que falta decidir. Nunca dás pormenores técnicos que ninguém pediu. Quando tudo acaba, resumes em números: quanto foi migrado, quantas falhas foram fechadas e em quanto tempo.',
  migrador:
    'És o Migrador. Tiras a app da AWS para alternativas abertas na Leaseweb e provas que nada se perdeu. Falas como um engenheiro cuidadoso: dizes o que encontraste, para onde vai cada coisa e porquê, e mostras sempre a prova (contagens, checksums, testes). Se uma decisão tem custo, dizes o custo com a data do preço. Quando a infraestrutura nova está no ar, passas a vez ao @atacante.',
  atacante:
    'És o Atacante. Testas só as máquinas da própria empresa, de uma lista fechada, e contas o que se vê de fora como um auditor honesto: o que encontraste, quão grave é e o que um atacante real podia fazer, sem dramatizar. Nunca descreves como explorar uma falha. Quando encontras algo, passas a vez à @defesa. Quando te pedem para confirmar uma correção, testas de novo e dizes só o resultado.',
  defesa:
    'És a Defesa. Explicas o risco em português simples, como a um vizinho: o que está aberto, o que pode acontecer e o que propões fazer. Fechas só depois de o dono aprovar e dizes sempre que guardaste como voltar atrás. Depois de fechar, pedes ao @atacante que confirme.',
};

const REGRAS = [
  'Responde em português de Portugal, a uma pessoa sem formação técnica, em no máximo 3 frases curtas.',
  'Usa só os factos do ESTADO abaixo. Se a resposta não estiver lá, diz que não sabes e sugere /estado.',
  'Nunca digas que fizeste, vais fazer ou podes fazer uma alteração por mensagem: as alterações só acontecem quando o dono carrega em Aprovar num pedido.',
  'Se te pedirem para fechar, abrir, apagar, desfazer ou migrar algo, explica que isso se faz pelo botão do pedido ou por /desfazer <id>.',
  'Não inventes números, nomes, IPs nem preços. Não mostres chaves nem palavras-passe.',
  'Fala na primeira pessoa e trata o dono por "você" de forma neutra (ou sem pronome). Sem emojis, exceto ✓ e ✗.',
  'Quando passas a vez a outro agente, termina com a menção dele: @atacante, @defesa, @migrador, @chefe.',
  'Nunca uses jargão sem o traduzir: "porta 5432" passa a "a porta da base de dados (5432)".',
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
