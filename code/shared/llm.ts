// Cliente LLM compatível com a API da OpenAI (POST {LLM_BASE_URL}/chat/completions).
// Pensado para fornecedores alojados na UE (TensorX, sference), configurados em env/.env:
//   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL            -> fornecedor principal
//   LLM_BASE_URL_2, LLM_API_KEY_2, LLM_MODEL_2      -> fornecedor de reserva (opcional)
// Usa o primeiro fornecedor disponível: tenta pela ordem e passa ao seguinte se faltar
// configuração, se der erro ou se exceder 20 s. Se todos falharem, quem chama usa textoFixo().
// A IA só produz texto. Nada do que o modelo devolve é executado.
import type { Achado, TipoAchado } from './tipos';

export interface MensagemChat {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FornecedorLLM {
  /** Nome para logs e auditoria (o host do URL). Nunca inclui a chave. */
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

export class ClienteLLM {
  constructor(
    private readonly fornecedores: FornecedorLLM[],
    private readonly timeoutMs: number = TIMEOUT_LLM_MS,
  ) {}

  static doEnv(env: NodeJS.ProcessEnv = process.env): ClienteLLM {
    return new ClienteLLM(fornecedoresDoEnv(env));
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

// ---------- texto fixo por tipo de achado (recurso quando o LLM falha) ----------

function servicoEPorta(a: Achado): string {
  const servico = a.servico ?? 'um serviço';
  return a.porta === undefined ? servico : `${servico} (porta ${a.porta})`;
}

function servidor(a: Achado): string {
  return a.alvoIp ? `o servidor ${a.alvoIp}` : 'um dos nossos servidores';
}

const TEXTO_FIXO: Record<TipoAchado, (a: Achado) => [string, string, string]> = {
  'porta-exposta': (a) => [
    `Em ${servidor(a)}, o acesso a ${servicoEPorta(a)} está aberto a qualquer pessoa na internet.`,
    'Alguém mal-intencionado pode usar esta porta para tentar entrar ou para copiar dados.',
    'Propomos fechar apenas esta regra de acesso, e pode desfazer com um clique.',
  ],
  'servico-exposto': (a) => [
    `Conseguimos falar com ${servicoEPorta(a)} em ${servidor(a)} a partir da internet.`,
    'Este serviço devia estar visível só para as nossas máquinas, não para toda a gente.',
    'Propomos fechar a regra que o deixa visível, e pode desfazer com um clique.',
  ],
  'credenciais-por-defeito': (a) => [
    `Em ${servidor(a)}, ${servicoEPorta(a)} aceita a palavra-passe de fábrica que toda a gente conhece.`,
    'Qualquer pessoa que a experimente consegue entrar e ver ou alterar os dados.',
    'Propomos fechar já o acesso pela internet, e a seguir mudar a palavra-passe.',
  ],
  'isco-tocado': (a) => [
    `Alguém tentou entrar no nosso servidor isco${a.alvoIp ? ` (${a.alvoIp})` : ''}, que existe só para apanhar curiosos.`,
    'É um sinal de que andam a procurar portas abertas nas nossas máquinas.',
    'Propomos fechar o acesso que foi tocado, e pode desfazer com um clique.',
  ],
};

/** Três frases fixas e simples para o tipo do achado. Nunca falha. */
export function textoFixo(achado: Achado): [string, string, string] {
  return TEXTO_FIXO[achado.tipo](achado);
}
