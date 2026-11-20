// npm run lsw:diagnostico -> SÓ LEITURA. Confirma a chave, lista security groups e regras,
// verifica se as regras trazem `id` (o revoke precisa) e mostra o que a defesa fecharia.
// Não mexe em nada. Nunca imprime a chave.
import { carregarConfig, leaseweb } from '@mwbe/shared';
import { avaliarRegra } from './detetar';

async function main(): Promise<void> {
  const cfg = carregarConfig(['LSW_API_KEY']);
  const geridos = new Set(cfg.leaseweb.securityGroupsGeridos);
  const grupos = await leaseweb.listarSecurityGroups();
  console.log(`Chave OK. ${grupos.length} security group(s).`);
  for (const g of grupos) {
    const marca = geridos.has(g.id) ? ' [GERIDO pela defesa]' : '';
    console.log(`\n${g.nome}  ${g.id}${marca}`);
    try {
      const regras = await leaseweb.listarRegrasComEstado(g.id);
      if (!regras.length) console.log('  (sem regras)');
      for (const r of regras) {
        const achado = avaliarRegra(g.id, r);
        const aviso = achado ? `  <- ${achado.severidade.toUpperCase()} ${achado.servico ?? ''}` : '';
        console.log(`  ${r.id}  ${r.protocol} ${r.startPort}-${r.endPort} de ${r.source} ${r.estado ?? ''}${aviso}`);
      }
    } catch (erro) {
      console.log('  ERRO:', erro instanceof Error ? erro.message : erro);
    }
  }
  if (!geridos.size) console.log('\nLSW_SG_GERIDOS está vazio: põe lá o id do security group da vítima.');
}

main().catch((erro) => {
  console.error('[diagnostico]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
