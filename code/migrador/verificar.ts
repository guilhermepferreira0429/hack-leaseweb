// Corre os mesmos testes da app de exemplo antes (contra AWS/LocalStack) e depois (contra a Leaseweb).
import { naoImplementado } from '@mwbe/shared';

export type Ambiente = 'aws' | 'leaseweb';

export interface ResultadoTestes {
  ambiente: Ambiente;
  passaram: number;
  falharam: number;
  nomesFalhados: string[];
  duracaoMs: number;
}

export interface Comparacao {
  antes: ResultadoTestes;
  depois: ResultadoTestes;
  /** true se depois passa pelo menos tudo o que passava antes. */
  equivalente: boolean;
}

/** Lança `tsx --test` em code/exemplo-app com as variáveis do ambiente pedido. */
export function correrTestes(ambiente: Ambiente, variaveis: Record<string, string>): Promise<ResultadoTestes> {
  return naoImplementado('correrTestes');
}

export function compararResultados(antes: ResultadoTestes, depois: ResultadoTestes): Comparacao {
  return naoImplementado('compararResultados');
}
