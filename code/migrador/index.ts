// Migrador: analisar -> (aprovação do dono) -> migrarS3 / migrarPostgres / migrarFila / migrarSegredos / migrarCache -> verificar.
export * from './analisar';
export * from './migrar-dados';
export * from './migrar-postgres';
export * from './migrar-fila';
export * from './migrar-segredos';
export * from './migrar-cache';
export * from './verificar';
