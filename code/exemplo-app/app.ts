// App de encomendas, mínima e realista:
// registarEncomenda guarda a fatura no armazenamento (S3), a linha na base de dados (RDS Postgres)
// e publica um evento na fila (SQS) para outro serviço processar.
import { naoImplementado } from '@mwbe/shared';
import type { Armazenamento, BaseDados, Fila } from './adaptadores';

export interface Encomenda {
  id: string;
  cliente: string;
  totalCentimos: number;
  /** Chave da fatura no armazenamento. */
  faturaChave: string;
  criadaEm: string;
}

export interface Dependencias {
  armazenamento: Armazenamento;
  baseDados: BaseDados;
  fila: Fila;
}

export const SQL_ESQUEMA = `
CREATE TABLE IF NOT EXISTS encomendas (
  id            TEXT PRIMARY KEY,
  cliente       TEXT NOT NULL,
  total_centimos INTEGER NOT NULL,
  fatura_chave  TEXT NOT NULL,
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

export function prepararEsquema(deps: Dependencias): Promise<void> {
  return naoImplementado('prepararEsquema');
}

export function registarEncomenda(
  deps: Dependencias,
  dados: { cliente: string; totalCentimos: number; fatura: Buffer },
): Promise<Encomenda> {
  return naoImplementado('registarEncomenda');
}

export function obterEncomenda(deps: Dependencias, id: string): Promise<Encomenda | undefined> {
  return naoImplementado('obterEncomenda');
}

/** Consome eventos 'encomenda-criada' da fila. */
export function processarEventos(deps: Dependencias, maximo?: number): Promise<string[]> {
  return naoImplementado('processarEventos');
}

/** Cria dados de exemplo (N encomendas com faturas) para a migração ter o que copiar. */
export function semear(deps: Dependencias, quantidade: number): Promise<Encomenda[]> {
  return naoImplementado('semear');
}
