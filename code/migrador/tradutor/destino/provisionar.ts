// Simulação (dry-run) do que se pediria à API da Leaseweb para alojar na Leaseweb 1 ou 2 serviços que o decisor
// mandou para um gerido de fora (ex.: Postgres na Scaleway): uma VM dedicada por serviço, com um grupo de segurança
// que só deixa entrar a app. Função pura: não chama nenhuma API e não cria nada.
// Reaproveita a forma dos pedidos do tradutor (PedidoLeaseweb, POST /instances, securityGroups, authorizeFirewallRules,
// attachSecurityGroups: docs/research/leaseweb-api.md). Preços só da tabela de docs/decisor-destino.md, com a data.
import type { PedidoLeaseweb } from '../tipos';
import { REGIAO_DESTINO } from '../tabelas';
import type { Decisao } from './decidir';
import { formatarNumero, formatarQuantidade } from './decidir';
import { GERIDO_LEASEWEB, MARGEM_RAM, type ServicoDestino } from './tabelas';

/** VMs da Leaseweb com preço publicado (docs/decisor-destino.md, vistos a 20/11/2026). Confirmar com GET /instanceTypes. */
export const VMS_LEASEWEB = [
  { type: 'lsw.c3.large', vcpu: 2, ramGb: 3, precoMes: 26.02 },
  { type: 'lsw.m3.large', vcpu: 2, ramGb: 7, precoMes: 29.44 },
  { type: 'lsw.r3.large', vcpu: 2, ramGb: 15.25, precoMes: 36.49 },
] as const;
/** Network SSD, € por GB por mês (mesma tabela). */
export const DISCO_GB_MES = 0.08;
export const PRECOS_VISTOS_EM = '2026-11-20';
/** Disco mínimo da VM: o valor do exemplo da referência da API (leaseweb-api.md). */
const DISCO_MINIMO_GB = 50;
const IMAGEM = 'UBUNTU_22_04_64BIT';
/** No máximo 2 serviços sugeridos, para a mensagem ficar curta. */
const MAX_SERVICOS = 2;

/** Serviços que fazem sentido numa VM dedicada da Leaseweb, com a porta que a app usa e a RAM recomendada. */
const VM_DEDICADA: Partial<Record<ServicoDestino, { nome: string; porta: number; ramRecomendadaGb?: number }>> = {
  postgres: { nome: 'PostgreSQL', porta: 5432, ramRecomendadaGb: 2 },
  mysql: { nome: 'MariaDB', porta: 3306 },
  documentdb: { nome: 'FerretDB', porta: 27017 },
  cache: { nome: 'Valkey', porta: 6379 },
  segredos: { nome: 'OpenBao', porta: 8200 },
};

export type ChamadaSimulada = { metodo: PedidoLeaseweb['metodo'] | 'PORTAL'; caminho: string; resumo: string; corpo?: Record<string, unknown> };

export type OpcoesSimulacao = {
  /** Rede da app que pode chegar ao serviço (CIDR). Sem ela, fica o marcador {appNetwork}. Nunca 0.0.0.0/0. */
  redeApp?: string;
};

function referencia(d: Decisao): string {
  const nome = d.nome && d.nome !== d.servico ? d.nome.split(',')[0]!.trim() : '';
  return `${d.servico}${nome ? `-${nome}` : ''}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

/** A VM mais pequena da tabela com RAM para o serviço, deixando 25% livre. */
function escolherVm(d: Decisao, ramRecomendadaGb = 0) {
  const precisa = Math.max(d.precisa.ramGb, ramRecomendadaGb) / (1 - MARGEM_RAM);
  return VMS_LEASEWEB.find((v) => v.ramGb >= precisa);
}

/** Resultado da simulação. `vms` e `portal` servem o resumo curto (resumoSimulacao). */
export type Simulacao = {
  chamadas: ChamadaSimulada[];
  texto: string;
  vms: { servico: string; type: string; custoMes: number; discoGb: number }[];
  portal: { servicoAws: string; plano: string }[];
  /** Orçamento: soma do custo mensal das VMs dedicadas (só os preços de lista da tabela, com data). Sem AWS: não se inventa poupança. */
  custoMesTotal: number;
};

export function simularProvisionamento(decisoes: Decisao[], opcoes: OpcoesSimulacao = {}): Simulacao {
  const rede = opcoes.redeApp?.trim();
  if (rede === '0.0.0.0/0' || rede === '::/0') throw new Error('simularProvisionamento: redeApp nunca pode ser a Internet inteira.');
  const origem = rede || '{appNetwork}';

  const chamadas: ChamadaSimulada[] = [];
  const linhas: string[] = [];
  const vms: Simulacao['vms'] = [];
  const portal: Simulacao['portal'] = [];

  // 1. Geridos que já são da Leaseweb (ex.: Object Storage para o S3): não há chamada documentada, é pelo portal.
  for (const d of decisoes.filter((x) => x.destino === 'gerido' && x.fornecedor === 'Leaseweb')) {
    const opcao = GERIDO_LEASEWEB[d.servico];
    portal.push({ servicoAws: d.servicoAws, plano: opcao?.plano ?? d.plano ?? d.servico });
    chamadas.push({
      metodo: 'PORTAL',
      caminho: `Customer Portal: ${opcao?.plano ?? d.plano ?? d.servico}`,
      resumo: `order ${opcao?.plano ?? d.plano} for ${d.servicoAws} (no public API call documented; to confirm)`,
    });
    linhas.push(`· ${d.servicoAws} → Leaseweb ${d.plano} (managed by Leaseweb).`);
  }

  // 2. Até 2 serviços que iam para um gerido de fora: uma VM dedicada na Leaseweb, primeiro os críticos.
  const candidatos = decisoes
    .filter((x) => x.destino === 'gerido' && x.fornecedor !== 'Leaseweb' && VM_DEDICADA[x.servico])
    .sort((a, b) => Number(b.criticidade === 'alta') - Number(a.criticidade === 'alta'))
    .slice(0, MAX_SERVICOS);

  for (const d of candidatos) {
    const alvo = VM_DEDICADA[d.servico]!;
    const vm = escolherVm(d, alvo.ramRecomendadaGb);
    if (!vm) {
      linhas.push(`· ${d.servicoAws}: no Leaseweb VM in the price table is big enough; keep ${d.fornecedor}.`);
      continue;
    }
    const ref = referencia(d);
    const disco = Math.max(DISCO_MINIMO_GB, Math.ceil(d.precisa.discoGb));
    const custo = Math.round((vm.precoMes + disco * DISCO_GB_MES) * 100) / 100;
    const sg = `{securityGroupId:${ref}}`;
    vms.push({ servico: alvo.nome, type: vm.type, custoMes: custo, discoGb: disco });
    chamadas.push(
      {
        metodo: 'POST',
        caminho: '/instances',
        resumo: `${vm.type} in ${REGIAO_DESTINO} for ${alvo.nome} (${ref})`,
        corpo: {
          region: REGIAO_DESTINO,
          type: vm.type,
          imageId: IMAGEM,
          contractType: 'HOURLY',
          rootDiskSize: disco,
          rootDiskStorageType: 'CENTRAL',
          reference: ref,
        },
      },
      { metodo: 'POST', caminho: '/securityGroups', resumo: `security group ${ref}`, corpo: { name: ref } },
      {
        metodo: 'POST',
        caminho: `/securityGroups/${sg}/authorizeFirewallRules`,
        resumo: `TCP ${alvo.porta} only from the app (${origem}), never from the whole Internet`,
        corpo: { rules: [{ protocol: 'TCP', startPort: alvo.porta, endPort: alvo.porta, source: origem }] },
      },
      {
        metodo: 'POST',
        caminho: `/instances/{instanceId:${ref}}/attachSecurityGroups`,
        resumo: `attach ${ref} to its security group`,
        corpo: { securityGroupIds: [sg] },
      },
    );
    linhas.push(
      `· ${alvo.nome} (${d.nome}) on a dedicated Leaseweb VM instead of ${d.fornecedor}: ${vm.type} (${vm.vcpu} vCPU, ${formatarQuantidade(vm.ramGb)} GB), ` +
        `about €${formatarNumero(custo)}/month with ${disco} GB disk (prices seen on ${PRECOS_VISTOS_EM.split('-').reverse().join('/')}).`,
    );
  }

  // Orçamento: só a soma dos preços de lista das VMs dedicadas (com data). Sem preços da AWS, não se calcula poupança.
  const custoMesTotal = Math.round(vms.reduce((s, v) => s + v.custoMes, 0) * 100) / 100;
  const dataPreco = PRECOS_VISTOS_EM.split('-').reverse().join('/');
  const orcamento =
    custoMesTotal > 0
      ? `Estimated Leaseweb cost for ${vms.length === 1 ? 'this VM' : 'these VMs'}: about €${formatarNumero(custoMesTotal)}/month (list prices, ${dataPreco}).`
      : '';

  const passos = chamadas.map((c, i) => `${i + 1}. ${c.metodo} ${c.caminho}: ${c.resumo}`);
  const texto = [
    'DRY-RUN: nothing was created.',
    linhas.length > 0 ? 'Leaseweb option:' : 'No Leaseweb option to suggest for these services.',
    ...linhas,
    ...(orcamento ? [orcamento] : []),
    ...(candidatos.length > 0 ? ['A dedicated VM is not high availability, and backups are on us.'] : []),
    ...(passos.length > 0 ? ['API calls I would make (not sent):', ...passos] : []),
    'Instance types and prices to be confirmed with GET /instanceTypes.',
  ].join('\n');
  return { chamadas, texto, vms, portal, custoMesTotal };
}

function juntar(itens: string[]): string {
  return itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} and ${itens.at(-1)}`;
}

/**
 * Versão curta da simulação para o Telegram (no máximo 3 linhas). O texto completo vai para a auditoria e o painel.
 * Só usa o que a simulação calculou: nenhum número novo.
 */
export function resumoSimulacao(sim: Simulacao): string {
  const linhas: string[] = [];
  if (sim.vms.length > 0) {
    const recursos = sim.chamadas.filter((c) => c.caminho === '/instances' || c.caminho === '/securityGroups').length;
    const tipos = [...new Set(sim.vms.map((v) => v.type))];
    const custos = [...new Set(sim.vms.map((v) => v.custoMes))];
    const servicos = juntar(sim.vms.map((v) => v.servico));
    const detalhe =
      tipos.length === 1 && custos.length === 1
        ? `${tipos[0]} in Amsterdam for ${servicos}, about €${formatarNumero(custos[0]!)}/month${sim.vms.length > 1 ? ' each' : ''}`
        : `in Amsterdam: ${juntar(sim.vms.map((v) => `${v.type} for ${v.servico} (about €${formatarNumero(v.custoMes)}/month)`))}`;
    linhas.push(`DRY-RUN: I would create ${recursos} resources on Leaseweb via API (${detalhe}).`);
  } else {
    linhas.push('DRY-RUN: no Leaseweb VM to create for these services.');
  }
  if (sim.portal.length > 0)
    linhas.push(`Plus ${juntar(sim.portal.map((p) => `Leaseweb ${p.plano} for ${p.servicoAws}`))}, ordered in the portal.`);
  // Orçamento na última linha (mantém o resumo em ≤3 linhas): a escolha mostra o custo mensal, sem inventar poupança.
  linhas.push(
    sim.custoMesTotal > 0
      ? `Nothing was created. Estimated budget: about €${formatarNumero(sim.custoMesTotal)}/month (Leaseweb list prices, ${PRECOS_VISTOS_EM.split('-').reverse().join('/')}).`
      : 'Nothing was created.',
  );
  return linhas.join('\n');
}
