// Extras de nível B do atacante: TLS/cabeçalhos, credenciais de fábrica e bucket público.
// Tudo é só leitura; a allowlist é conferida dentro de cada módulo antes de cada ligação.
import type { Achado } from '@mwbe/shared';
import { garantirPermitido } from './alvos';
import { testarCredenciaisPorDefeito, verificarBucketPublico } from './credenciais';
import { verificarHttp } from './http';

export interface OpcoesExtras {
  /** Nome do bucket a testar; vazio = não testa. */
  bucket?: string;
  portaBucket?: number;
  httpsBucket?: boolean;
}

/** Corre os extras num alvo já permitido e devolve os achados. */
export async function executarExtras(
  alvo: string,
  allowlist: ReadonlySet<string>,
  opcoes: OpcoesExtras = {},
): Promise<Achado[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);

  const achados: Achado[] = [
    ...(await verificarHttp(endereco, allowlist)),
    ...(await testarCredenciaisPorDefeito(endereco, allowlist)),
  ];

  if (opcoes.bucket?.trim()) {
    achados.push(
      ...(await verificarBucketPublico(endereco, opcoes.portaBucket ?? 9000, opcoes.bucket, allowlist, {
        https: opcoes.httpsBucket,
      })),
    );
  }
  return achados;
}
