// S3 (LocalStack) -> MinIO, com verificação por sha256 de cada objeto.
// Postgres e fila ficam fora hoje (slide), ver docs/plano.md.
import { naoImplementado } from '@mwbe/shared';

export interface ChecksumObjeto {
  chave: string;
  origem: string;
  destino: string;
}

/** Lista o bucket na origem, copia cada objeto para o MinIO e compara sha256 dos dois lados. */
export function migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }> {
  return naoImplementado('migrarS3');
}

/** sha256 em hex de um corpo. */
export function sha256(conteudo: Uint8Array): string {
  return naoImplementado('sha256');
}
