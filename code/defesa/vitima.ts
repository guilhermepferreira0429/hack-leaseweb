// npm run lsw:vitima -- criar | estado | destruir | destruir-vm
// A VM vítima da demo na Leaseweb Public Cloud (docs/arquitetura.md): Frankfurt, a mais barata, à hora.
//   security group "vitima": 22 só dos IPs de VITIMA_ADMIN_IPS; 5432 de 0.0.0.0/0 (a falha que a defesa fecha)
//   por SSH depois de arrancar: o escutador inofensivo na 5432 (env/vitima-5432.service), para o nmap dar "open"
// Idempotente: se o grupo ou a VM já existirem (pelo nome/referência), reutiliza. Nunca mexe no grupo "Default".
// destruir: apaga a VM e depois o grupo. Custa dinheiro enquanto existir: destruir no fim do evento.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { carregarConfig, leaseweb } from '@mwbe/shared';

const NOME = 'vitima';
const REGIAO = process.env.VITIMA_REGIAO || 'eu-central-1'; // Frankfurt (UE): a única região que a conta do evento aceita
const TIPO = process.env.VITIMA_TIPO || 'lsw.c3.large'; // 2 vCPU, 3 GB, a mais barata
const IMAGEM = process.env.VITIMA_IMAGEM || 'UBUNTU_24_04_64BIT';

type Grupo = { id: string; name?: string };
type Instancia = { id: string; reference?: string; state?: string; region?: string; ips?: { ip: string; networkType?: string; version?: number }[] };

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Instala o escutador inofensivo na 5432 por SSH (env/vitima-5432.service).
 * O userData (cloud-init) não foi aplicado no ensaio de 20/11 e a API não aceita sshKey + userData juntos,
 * por isso a VM nasce só com a chave e o resto faz-se por SSH, que é verificável. A Leaseweb põe a chave no root.
 */
async function instalarEscutador(ip: string): Promise<void> {
  const unidade = readFileSync(new URL('../../env/vitima-5432.service', import.meta.url), 'utf8');
  const cmd = 'sudo tee /etc/systemd/system/vitima-5432.service >/dev/null && sudo systemctl daemon-reload && sudo systemctl enable --now vitima-5432 && systemctl is-active vitima-5432';
  for (let i = 0; i < 30; i++) {
    const r = await new Promise<{ ok: boolean; saida: string }>((ok) => {
      const p = execFile(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=8', `${process.env.VITIMA_SSH_USER || 'root'}@${ip}`, cmd],
        { timeout: 60_000 },
        (erro, stdout, stderr) => ok({ ok: !erro, saida: (stdout + stderr).trim() }),
      );
      p.stdin?.end(unidade);
    });
    if (r.ok) return void console.log(`escutador na 5432: ${r.saida.split('\n').pop()}`);
    if (i === 0 || i % 5 === 4) console.log(`à espera do SSH da vítima... (${r.saida.split('\n').pop()})`);
    await esperar(10_000);
  }
  throw new Error('Não consegui entrar por SSH na vítima para instalar o escutador');
}

async function grupoVitima(): Promise<Grupo | undefined> {
  return (await leaseweb.listarSecurityGroups()).map((g) => ({ id: g.id, name: g.nome })).find((g) => g.name === NOME);
}

async function instanciaVitima(): Promise<Instancia | undefined> {
  const r = await leaseweb.pedido<{ instances?: Instancia[] }>('GET', '/instances?limit=50');
  return (r?.instances ?? []).find((i) => i.reference === NOME && i.state !== 'DESTROYED' && i.state !== 'DESTROYING');
}

const ipPublico = (i?: Instancia) => i?.ips?.find((x) => x.networkType !== 'INTERNAL' && isIP(x.ip) === 4)?.ip;

async function criar(): Promise<void> {
  const admin = (process.env.VITIMA_ADMIN_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!admin.length || admin.some((ip) => isIP(ip) === 0)) throw new Error('VITIMA_ADMIN_IPS: lista de IPs literais para o SSH (ex.: o do cérebro e o teu)');
  const chave = readFileSync(process.env.VITIMA_SSH_PUB || `${homedir()}/.ssh/id_ed25519.pub`, 'utf8').trim();

  // 1. Grupo e regras, antes da VM (a VM nasce já com as regras certas).
  let g = await grupoVitima();
  if (!g) {
    g = await leaseweb.pedido<Grupo>('POST', '/securityGroups', { name: NOME });
    console.log(`grupo "${NOME}" criado: ${g.id}`);
  } else console.log(`grupo "${NOME}" já existe: ${g.id}`);
  const regras = await leaseweb.listarRegras(g.id);
  const querem = [
    ...admin.map((ip) => ({ protocol: 'TCP', startPort: 22, endPort: 22, source: `${ip}/32` })),
    { protocol: 'TCP', startPort: 5432, endPort: 5432, source: '0.0.0.0/0' },
  ];
  for (const r of querem) {
    if (regras.some((x) => x.protocol === r.protocol && x.startPort === r.startPort && x.source === r.source)) continue;
    const nova = await leaseweb.criarRegra(g.id, r);
    console.log(`regra: ${nova.protocol} ${nova.startPort} de ${nova.source} (${nova.id})`);
  }

  // 2. VM.
  let inst = await instanciaVitima();
  if (!inst) {
    const corpo = {
      region: REGIAO,
      type: TIPO,
      imageId: IMAGEM,
      contractType: 'HOURLY',
      billingFrequency: 1,
      rootDiskSize: 10,
      rootDiskStorageType: 'CENTRAL',
      reference: NOME,
      sshKey: chave,
      securityGroupIds: [g.id],
    };
    try {
      inst = await leaseweb.pedido<Instancia>('POST', '/instances', corpo);
    } catch (erro) {
      // Se a API não aceitar o grupo no lançamento, lança sem ele e associa depois.
      if (!(erro instanceof leaseweb.ErroLeaseweb) || erro.estado !== 400 || !/securityGroup/i.test(erro.message)) throw erro;
      const { securityGroupIds: _s, ...semGrupo } = corpo;
      inst = await leaseweb.pedido<Instancia>('POST', '/instances', semGrupo);
      console.log('(o lançamento não aceitou o grupo; a associar depois de arrancar)');
    }
    console.log(`VM lançada: ${inst.id} (${REGIAO}, ${TIPO})`);
  } else console.log(`VM "${NOME}" já existe: ${inst.id} (${inst.state})`);

  // 3. Esperar que arranque e tenha IP.
  for (let i = 0; i < 90; i++) {
    inst = await leaseweb.pedido<Instancia>('GET', `/instances/${inst.id}`);
    if (inst.state === 'RUNNING' && ipPublico(inst)) break;
    await esperar(10_000);
  }
  const grupos = await leaseweb.pedido<{ securityGroups?: Grupo[] }>('GET', `/instances/${inst.id}/securityGroups`);
  if (!(grupos?.securityGroups ?? []).some((x) => x.id === g.id)) {
    await leaseweb.pedido('POST', `/instances/${inst.id}/attachSecurityGroups`, { securityGroupIds: [g.id] });
    console.log(`grupo "${NOME}" associado à VM`);
  }
  const ip = ipPublico(inst);
  if (ip) await instalarEscutador(ip);
  await estado();
}

async function estado(): Promise<void> {
  const g = await grupoVitima();
  const inst = await instanciaVitima();
  const ip = ipPublico(inst);
  console.log(`\ngrupo:  ${g?.id ?? '(não existe)'}`);
  if (g) for (const r of await leaseweb.listarRegras(g.id)) console.log(`  ${r.id}  ${r.protocol} ${r.startPort}-${r.endPort} de ${r.source}`);
  console.log(`VM:     ${inst ? `${inst.id} ${inst.state} ${inst.region} ${ip ?? '(sem IP ainda)'}` : '(não existe)'}`);
  if (inst) {
    const gs = await leaseweb.pedido<{ securityGroups?: Grupo[] }>('GET', `/instances/${inst.id}/securityGroups`);
    console.log(`grupos da VM: ${(gs?.securityGroups ?? []).map((x) => x.name ?? x.id).join(', ') || '(nenhum)'}`);
  }
  if (g && ip) console.log(`\nPara o .env:\nLSW_SG_GERIDOS=${g.id}\nLSW_IP_SG=${ip}=${g.id}\nALVOS_PERMITIDOS=${ip}`);
}

/** Só a VM (o grupo fica): para relançar sem perder as regras. */
async function destruirVm(): Promise<void> {
  const inst = await instanciaVitima();
  if (!inst) return void console.log('não há VM vítima');
  await leaseweb.pedido('DELETE', `/instances/${inst.id}`);
  console.log(`VM ${inst.id} a ser destruída`);
  for (let i = 0; i < 60 && (await instanciaVitima()); i++) await esperar(10_000);
  console.log('destruída');
}

async function destruir(): Promise<void> {
  const inst = await instanciaVitima();
  if (inst) {
    await leaseweb.pedido('DELETE', `/instances/${inst.id}`);
    console.log(`VM ${inst.id} a ser destruída`);
    for (let i = 0; i < 60 && (await instanciaVitima()); i++) await esperar(10_000);
  }
  const g = await grupoVitima();
  if (g) {
    await leaseweb.pedido('DELETE', `/securityGroups/${g.id}`);
    console.log(`grupo ${g.id} apagado`);
  }
}

const acoes: Record<string, () => Promise<void>> = { criar, estado, destruir, 'destruir-vm': destruirVm };
const acao = acoes[process.argv[2] ?? 'estado'];
if (!acao) {
  console.error('Uso: npm run lsw:vitima -- criar | estado | destruir');
  process.exitCode = 1;
} else {
  carregarConfig(['LSW_API_KEY']);
  acao().catch((erro) => {
    console.error('[vitima]', erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
