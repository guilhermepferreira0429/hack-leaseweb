// Migrador: analisar -> (aprovação do dono) -> migrarS3 / migrarPostgres / migrarFila -> verificar.
export * from './analisar';
export * from './migrar-dados';
export * from './migrar-postgres';
export * from './migrar-fila';
export * from './verificar';
