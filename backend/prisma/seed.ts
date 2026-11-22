// Seed idempotente: pode rodar a cada subida do container.
//
// Sempre cria: o administrador inicial e a pauta padrão de cada etapa.
// Com SEED_DEMO=1 cria também organizações, um usuário por perfil, um
// empreendimento com unidades e um cliente — para homologação e treinamento.
import { Etapa, Perfil, PrismaClient, TipoOrganizacao } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const PAUTA: Record<Etapa, [string, string[]][]> = {
  CONSTRUTORA_INCORPORADORA: [
    ['Geral', ['Limpeza final da unidade', 'Pintura de paredes e tetos', 'Pisos e rodapés', 'Portas, batentes e fechaduras', 'Esquadrias e vidros']],
    ['Instalações elétricas', ['Quadro de distribuição identificado', 'Tomadas e interruptores', 'Pontos de iluminação']],
    ['Instalações hidráulicas', ['Pontos de água e registros', 'Esgoto e ralos (teste de escoamento)', 'Ausência de vazamentos e infiltrações']],
    ['Cozinha e área de serviço', ['Bancadas e cubas', 'Revestimentos e rejuntes']],
    ['Banheiros', ['Louças e metais', 'Impermeabilização (teste de estanqueidade)', 'Revestimentos e rejuntes']],
    ['Varanda', ['Guarda-corpo e fixações', 'Caimento e escoamento do piso']],
  ],
  INCORPORADORA_RELACIONAMENTO: [
    ['Documentação', ['Termo de recebimento da construtora assinado', 'Manual do proprietário', 'Habite-se e documentação do empreendimento']],
    ['Chaves', ['Jogo completo de chaves da unidade', 'Controles e tags de acesso']],
    ['Unidade', ['Unidade limpa e pronta para apresentação', 'Ressalvas da vistoria técnica tratadas', 'Medidores e ligações (água, luz, gás) identificados']],
  ],
  RELACIONAMENTO_CLIENTE: [
    ['Geral', ['Pintura de paredes e tetos', 'Pisos e rodapés', 'Portas e fechaduras', 'Janelas e vidros']],
    ['Elétrica', ['Tomadas, interruptores e iluminação', 'Quadro de distribuição']],
    ['Hidráulica', ['Torneiras, registros e descargas', 'Ralos e escoamento']],
    ['Cozinha e área de serviço', ['Bancadas, cubas e revestimentos']],
    ['Banheiros', ['Louças, metais e revestimentos']],
    ['Entrega', ['Manual do proprietário entregue', 'Chaves, controles e tags entregues', 'Leitura dos medidores registrada']],
  ],
};

async function main() {
  // Sem senha definida, sorteia uma: nenhuma instalação sobe com senha conhecida
  const senhaDefinida = process.env.SEED_SENHA_PADRAO;
  const senhaPadrao = senhaDefinida || randomBytes(12).toString('base64url');
  const senhaHash = await bcrypt.hash(senhaPadrao, 10);
  let criouUsuarios = false;

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@sysentrega.local').toLowerCase();
  if (!(await prisma.usuario.findUnique({ where: { email: adminEmail } }))) {
    await prisma.usuario.create({
      data: { nome: 'Administrador', email: adminEmail, senhaHash, perfil: Perfil.ADMINISTRADOR },
    });
    criouUsuarios = true;
  }

  for (const etapa of Object.keys(PAUTA) as Etapa[]) {
    if ((await prisma.modeloItem.count({ where: { etapa } })) > 0) continue;
    let ordem = 0;
    for (const [ambiente, itens] of PAUTA[etapa]) {
      for (const descricao of itens) {
        await prisma.modeloItem.create({ data: { etapa, ambiente, descricao, ordem: ordem++ } });
      }
    }
  }

  if (process.env.SEED_DEMO === '1' && (await prisma.organizacao.count()) === 0) {
    const construtora = await prisma.organizacao.create({
      data: { nome: 'Construtora Exemplo Ltda', cnpj: '11222333000181', tipo: TipoOrganizacao.CONSTRUTORA },
    });
    const outraConstrutora = await prisma.organizacao.create({
      data: { nome: 'Outra Construtora S.A.', tipo: TipoOrganizacao.CONSTRUTORA },
    });
    const incorporadora = await prisma.organizacao.create({
      data: { nome: 'RSF Incorporadora', tipo: TipoOrganizacao.INCORPORADORA },
    });
    const central = await prisma.organizacao.create({
      data: { nome: 'RSF Central de Relacionamento', tipo: TipoOrganizacao.CENTRAL_RELACIONAMENTO },
    });

    criouUsuarios = true;
    const usuarios: [string, string, Perfil, string | null][] = [
      ['Carlos Construtor', 'construtora@exemplo.com', Perfil.CONSTRUTORA, construtora.id],
      ['Olívia Outra', 'outra.construtora@exemplo.com', Perfil.CONSTRUTORA, outraConstrutora.id],
      ['Inês Incorporadora', 'incorporadora@exemplo.com', Perfil.INCORPORADORA, incorporadora.id],
      ['Renata Relacionamento', 'relacionamento@exemplo.com', Perfil.RELACIONAMENTO, central.id],
      ['Alberto Auditor', 'auditor@exemplo.com', Perfil.AUDITOR, null],
    ];
    for (const [nome, email, perfil, organizacaoId] of usuarios) {
      await prisma.usuario.create({ data: { nome, email, senhaHash, perfil, organizacaoId } });
    }

    const emp = await prisma.empreendimento.create({
      data: {
        codigo: '01',
        nome: 'Residencial Exemplo',
        endereco: 'Rua das Acácias, 100 — Centro',
        construtoraId: construtora.id,
        incorporadoraId: incorporadora.id,
      },
    });
    await prisma.empreendimento.create({
      data: { codigo: '02', nome: 'Edifício Outro', construtoraId: outraConstrutora.id, incorporadoraId: incorporadora.id, unidades: { create: [{ numero: '11' }] } },
    });
    const cliente = await prisma.cliente.create({
      data: { nome: 'Maria Souza Oliveira', cpfCnpj: '52998224725', email: 'maria@exemplo.com', telefone: '(11) 99999-0000' },
    });
    for (const [andar, numeros] of [['1', ['101', '102', '103']], ['2', ['201', '202', '203']]] as [string, string[]][]) {
      for (const numero of numeros) {
        await prisma.unidade.create({
          data: {
            empreendimentoId: emp.id,
            bloco: 'Torre A',
            numero,
            andar,
            tipologia: '2 dormitórios',
            clienteId: numero === '101' ? cliente.id : null,
          },
        });
      }
    }
    console.log('Seed: dados de demonstração criados');
  }
  console.log(`Seed concluído. Administrador: ${adminEmail}`);
  if (criouUsuarios && !senhaDefinida) {
    console.log(`SENHA INICIAL (anote e troque no primeiro acesso; não será mostrada de novo): ${senhaPadrao}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
