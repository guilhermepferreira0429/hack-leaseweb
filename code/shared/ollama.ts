// Cliente Ollama via API compatível com OpenAI: POST {baseUrl}/v1/chat/completions
// A IA só devolve texto. Nunca se interpreta a saída do modelo como comando.
import { naoImplementado } from './stub';

export interface MensagemChat {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpcoesOllama {
  /** Ex.: http://localhost:11434 */
  baseUrl: string;
  modelo: string;
  timeoutMs?: number;
}

export class ClienteOllama {
  constructor(private readonly opcoes: OpcoesOllama) {}

  /** Devolve só o texto da primeira escolha. */
  conversar(mensagens: MensagemChat[], temperatura = 0.2): Promise<string> {
    return naoImplementado('ClienteOllama.conversar');
  }

  /** Verifica se o servidor responde e o modelo existe (GET /v1/models). */
  estaDisponivel(): Promise<boolean> {
    return naoImplementado('ClienteOllama.estaDisponivel');
  }
}
