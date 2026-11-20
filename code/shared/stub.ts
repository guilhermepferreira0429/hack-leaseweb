/** Marca um stub. Falha fechado: se for chamado antes de implementado, nada acontece na infraestrutura. */
export function naoImplementado(nome: string): never {
  throw new Error(`Ainda não implementado: ${nome}`);
}
