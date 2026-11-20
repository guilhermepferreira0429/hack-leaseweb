// Tradutor AWS (Terraform JSON) -> plano Leaseweb, com porta de segurança. Só plano (dry-run): não chama APIs.
export type * from './tipos';
export { traduzir, normalizarAdminIp, POR_ESCOLHER } from './traduzir';
export { resumoPlano } from './resumo';
export { REGIAO_DESTINO, PORTAS_SENSIVEIS, TIPOS, IMAGENS } from './tabelas';
