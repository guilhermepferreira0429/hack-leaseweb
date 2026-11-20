// Cliente LLM compatível com a API da OpenAI (POST {LLM_BASE_URL}/chat/completions),
// para fornecedores na UE (TensorX ou sference). Configuração no .env:
//   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL            -> fornecedor principal
//   LLM_BASE_URL_2, LLM_API_KEY_2, LLM_MODEL_2      -> fornecedor de reserva (opcional)
//   LLM_TIMEOUT_MS                                  -> por tentativa (por defeito 20000)
// Usa o primeiro fornecedor disponível: tenta pela ordem e passa ao seguinte se faltar configuração,
// se der erro ou se exceder o timeout. Se nenhum responder, devolve o texto fixo do tipo de achado.
// A IA só produz texto. Nada do que o modelo devolve é executado.
import type { Achado, TipoAchado } from './tipos';

export interface MensagemChat {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FornecedorLLM {
  /** Nome para logs (o host do URL). Nunca inclui a chave. */
  nome: string;
  /** URL base compatível com OpenAI, normalmente terminado em /v1. */
  baseUrl: string;
  apiKey: string;
  modelo: string;
}

export interface RespostaLLM {
  texto: string;
  fornecedor: string;
  modelo: string;
}

export const TIMEOUT_LLM_MS = 20_000;
export const MAX_CARACTERES = 600;

/** Sufixos dos conjuntos de variáveis, por ordem de preferência. */
const SUFIXOS = ['', '_2'] as const;

export class ErroLLM extends Error {
  constructor(readonly falhas: { fornecedor: string; motivo: string }[]) {
    super(
      falhas.length === 0
        ? 'Nenhum fornecedor LLM configurado (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).'
        : `Todos os fornecedores LLM falharam: ${falhas.map((f) => `${f.fornecedor} (${f.motivo})`).join('; ')}`,
    );
    this.name = 'ErroLLM';
  }
}

/** Lê os fornecedores do ambiente. Só entram os que têm URL, chave e modelo preenchidos. */
export function fornecedoresDoEnv(env: NodeJS.ProcessEnv = process.env): FornecedorLLM[] {
  const fornecedores: FornecedorLLM[] = [];
  for (const sufixo of SUFIXOS) {
    const baseUrl = env[`LLM_BASE_URL${sufixo}`]?.trim();
    const apiKey = env[`LLM_API_KEY${sufixo}`]?.trim();
    const modelo = env[`LLM_MODEL${sufixo}`]?.trim();
    if (!baseUrl || !apiKey || !modelo) continue;
    let nome: string;
    try {
      nome = new URL(baseUrl).host;
    } catch {
      console.warn(`[llm] LLM_BASE_URL${sufixo} inválido, ignorado.`);
      continue;
    }
    fornecedores.push({ nome, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, modelo });
  }
  return fornecedores;
}

function timeoutDoEnv(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env.LLM_TIMEOUT_MS);
  return Number.isFinite(valor) && valor > 0 ? valor : TIMEOUT_LLM_MS;
}

export class ClienteLLM {
  constructor(
    private readonly fornecedores: FornecedorLLM[],
    private readonly timeoutMs: number = TIMEOUT_LLM_MS,
  ) {}

  static doEnv(env: NodeJS.ProcessEnv = process.env): ClienteLLM {
    return new ClienteLLM(fornecedoresDoEnv(env), timeoutDoEnv(env));
  }

  get configurado(): boolean {
    return this.fornecedores.length > 0;
  }

  /** Tenta cada fornecedor pela ordem; devolve a primeira resposta com texto. Lança ErroLLM se nenhum responder. */
  async conversar(mensagens: MensagemChat[], temperatura = 0.2): Promise<RespostaLLM> {
    const falhas: { fornecedor: string; motivo: string }[] = [];
    for (const fornecedor of this.fornecedores) {
      try {
        const texto = await this.pedir(fornecedor, mensagens, temperatura);
        return { texto, fornecedor: fornecedor.nome, modelo: fornecedor.modelo };
      } catch (erro) {
        falhas.push({ fornecedor: fornecedor.nome, motivo: descreverErro(erro, this.timeoutMs) });
      }
    }
    throw new ErroLLM(falhas);
  }

  private async pedir(f: FornecedorLLM, mensagens: MensagemChat[], temperatura: number): Promise<string> {
    const resposta = await fetch(`${f.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${f.apiKey}`,
      },
      body: JSON.stringify({ model: f.modelo, messages: mensagens, temperature: temperatura }),
      // Cobre ligação, cabeçalhos e leitura do corpo.
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = (await resposta.json()) as { choices?: { message?: { content?: string | null } }[] };
    const texto = dados.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error('resposta sem texto');
    return texto;
  }
}

function descreverErro(erro: unknown, timeoutMs: number): string {
  if (erro instanceof Error) {
    if (erro.name === 'TimeoutError' || erro.name === 'AbortError') return `timeout após ${timeoutMs / 1000} s`;
    return erro.message;
  }
  return String(erro);
}

// ---------- explicar (contrato de docs/interfaces.md) ----------

export const PROMPT_SISTEMA = [
  'Explicas problemas de segurança a donos de pequenas empresas, sem formação técnica.',
  'Responde em português de Portugal, no máximo 3 frases curtas e 600 caracteres:',
  '1) o que está aberto, 2) o que um atacante podia fazer, 3) o que acontece se o dono aprovar (fechamos só esse acesso, e pode desfazer-se).',
  'Sem jargão, sem comandos, sem listas, sem inventar dados que não estejam no achado.',
].join(' ');

/** Fica com as 3 primeiras frases. Devolve undefined se o resultado não servir (vazio ou longo demais). */
export function limitarTresFrases(texto: string): string | undefined {
  const frases = texto
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const resultado = frases.join(' ');
  return resultado && resultado.length <= MAX_CARACTERES ? resultado : undefined;
}

let clientePorDefeito: ClienteLLM | undefined;

/** 3 frases em português simples. Nunca lança: se o LLM falhar, devolve textoFixo(achado). */
export async function explicar(achado: Achado, cliente?: ClienteLLM): Promise<string> {
  const llm = cliente ?? (clientePorDefeito ??= ClienteLLM.doEnv());
  if (!llm.configurado) return textoFixo(achado);
  const dados = {
    tipo: achado.tipo,
    alvo: achado.alvo,
    porta: achado.porta,
    servico: achado.servico,
    severidade: achado.severidade,
    detalhe: achado.detalhe,
  };
  try {
    const { texto } = await llm.conversar([
      { role: 'system', content: PROMPT_SISTEMA },
      { role: 'user', content: `Achado: ${JSON.stringify(dados)}` },
    ]);
    return limitarTresFrases(texto) ?? textoFixo(achado);
  } catch (erro) {
    console.warn('[llm]', erro instanceof Error ? erro.message : erro, '-> texto fixo');
    return textoFixo(achado);
  }
}

// ---------- texto fixo por tipo de achado ----------

function servicoEPorta(a: Achado): string {
  return `${a.servico ?? 'um serviço'} (porta ${a.porta})`;
}

const TEXTO_FIXO: Record<TipoAchado, (a: Achado) => string> = {
  'porta-exposta': (a) =>
    `No servidor ${a.alvo}, o acesso a ${servicoEPorta(a)} está aberto a qualquer pessoa na internet. ` +
    'Alguém mal-intencionado pode usar esta porta para tentar entrar ou para copiar dados. ' +
    'Se aprovar, fechamos apenas este acesso, e pode desfazer-se com um clique.',
  'servico-exposto': (a) =>
    `Conseguimos falar com ${servicoEPorta(a)} no servidor ${a.alvo} a partir da internet. ` +
    'Este serviço devia estar visível só para as nossas máquinas, não para toda a gente. ' +
    'Se aprovar, fechamos o acesso que o deixa visível, e pode desfazer-se com um clique.',
  'credenciais-por-defeito': (a) =>
    `No servidor ${a.alvo}, ${servicoEPorta(a)} aceita a palavra-passe de fábrica que toda a gente conhece. ` +
    'Qualquer pessoa que a experimente consegue entrar e ver ou alterar os dados. ' +
    'Se aprovar, fechamos já o acesso pela internet; a seguir convém mudar a palavra-passe.',
  'isco-tocado': (a) =>
    `Alguém tentou entrar no nosso servidor isco (${a.alvo}), que existe só para apanhar curiosos. ` +
    'É sinal de que andam a procurar portas abertas nas nossas máquinas. ' +
    'Se aprovar, fechamos o acesso que foi tocado, e pode desfazer-se com um clique.',
};

/** Texto fixo e simples para o tipo do achado. Nunca falha. */
export function textoFixo(achado: Achado): string {
  return TEXTO_FIXO[achado.tipo](achado);
}
