import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Etapa, Perfil, Prisma, TipoOrganizacao } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Perfis } from '../auth/roles.decorator';
import { Contexto, Ctx } from '../comum/contexto';
import { cnpjValido, cpfCnpjValido, cpfValido, soDigitos } from '../comum/util';
import { PrismaService } from '../prisma/prisma.service';

class OrganizacaoDto {
  @IsString() @MinLength(2) @MaxLength(160) nome: string;
  @IsOptional() @IsString() @MaxLength(20) cnpj?: string;
  @IsEnum(TipoOrganizacao) tipo: TipoOrganizacao;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class EmpreendimentoDto {
  @IsString() @MinLength(1) @MaxLength(20) codigo: string;
  @IsString() @MinLength(2) @MaxLength(160) nome: string;
  @IsOptional() @IsString() @MaxLength(300) endereco?: string;
  @IsString() construtoraId: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() incorporadoraId?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class ClienteDto {
  @IsString() @MinLength(2) @MaxLength(160) nome: string;
  @IsString() @MaxLength(20) cpfCnpj: string;
  @IsOptional() @ValidateIf((_o, v) => v !== '' && v !== null) @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
}

class UsuarioDto {
  @IsString() @MinLength(2) @MaxLength(160) nome: string;
  @IsEmail() @MaxLength(200) email: string;
  @IsOptional() @IsString() @MaxLength(20) cpf?: string;
  @IsEnum(Perfil) perfil: Perfil;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() organizacaoId?: string | null;
  // Obrigatória ao criar; ao editar, só quando for para trocar
  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' }) @MaxLength(200) senha?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  // Pode ver o sistema como qualquer perfil (só com CONTAS_DE_TESTE=1)
  @IsOptional() @IsBoolean() contaTeste?: boolean;
}

class ModeloItemDto {
  @IsEnum(Etapa) etapa: Etapa;
  @IsString() @MinLength(1) @MaxLength(80) ambiente: string;
  @IsString() @MinLength(2) @MaxLength(300) descricao: string;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

function unicoViolado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}

const USUARIO_PUBLICO = {
  id: true,
  nome: true,
  email: true,
  cpf: true,
  perfil: true,
  organizacaoId: true,
  ativo: true,
  contaTeste: true,
  criadoEm: true,
  organizacao: { select: { nome: true } },
} as const;

// Cadastros de apoio. Leitura para quem precisa montar telas; escrita
// restrita por perfil, sempre com registro na auditoria (antes e depois).
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CadastrosController {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
  ) {}

  private async registrar(
    ctx: Contexto,
    acao: string,
    descricao: string,
    entidade: string,
    entidadeId: string,
    antes: unknown,
    depois: unknown,
    tx: Prisma.TransactionClient,
  ) {
    await this.auditoria.registrar(
      { acao, descricao, entidade, entidadeId, ator: ctx.ator, dados: { antes, depois } as any },
      tx,
    );
  }

  // ---------- organizações ----------

  @Get('organizacoes')
  @Perfis(Perfil.INCORPORADORA, Perfil.RELACIONAMENTO)
  organizacoes() {
    return this.prisma.organizacao.findMany({ orderBy: [{ tipo: 'asc' }, { nome: 'asc' }] });
  }

  private validarOrganizacao(dto: OrganizacaoDto) {
    const cnpj = soDigitos(dto.cnpj) || null;
    if (cnpj && !cnpjValido(cnpj)) throw new BadRequestException('CNPJ inválido');
    return { nome: dto.nome.trim(), cnpj, tipo: dto.tipo, ativo: dto.ativo ?? true };
  }

  @Post('organizacoes')
  @Perfis(Perfil.ADMINISTRADOR)
  criarOrganizacao(@Body() dto: OrganizacaoDto, @Ctx() ctx: Contexto) {
    const data = this.validarOrganizacao(dto);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organizacao.create({ data });
      await this.registrar(ctx, 'ORGANIZACAO_CRIADA', `Organização ${org.nome} cadastrada`, 'Organizacao', org.id, null, data, tx);
      return org;
    });
  }

  @Patch('organizacoes/:id')
  @Perfis(Perfil.ADMINISTRADOR)
  async editarOrganizacao(@Param('id') id: string, @Body() dto: OrganizacaoDto, @Ctx() ctx: Contexto) {
    const antes = await this.prisma.organizacao.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Organização não encontrada');
    const data = this.validarOrganizacao(dto);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organizacao.update({ where: { id }, data });
      await this.registrar(ctx, 'ORGANIZACAO_ALTERADA', `Organização ${org.nome} alterada`, 'Organizacao', id, antes, data, tx);
      return org;
    });
  }

  // ---------- empreendimentos ----------

  @Get('empreendimentos')
  empreendimentos(@Ctx() ctx: Contexto) {
    return this.prisma.empreendimento.findMany({
      where:
        ctx.usuario.perfil === Perfil.CONSTRUTORA
          ? { construtoraId: ctx.usuario.organizacaoId ?? '__sem_organizacao__' }
          : {},
      include: {
        construtora: { select: { nome: true } },
        incorporadora: { select: { nome: true } },
        _count: { select: { unidades: true } },
      },
      orderBy: { nome: 'asc' },
    });
  }

  private async validarEmpreendimento(dto: EmpreendimentoDto) {
    const construtora = await this.prisma.organizacao.findUnique({ where: { id: dto.construtoraId } });
    if (!construtora || construtora.tipo !== TipoOrganizacao.CONSTRUTORA) {
      throw new BadRequestException('Selecione uma construtora válida');
    }
    if (dto.incorporadoraId) {
      const inc = await this.prisma.organizacao.findUnique({ where: { id: dto.incorporadoraId } });
      if (!inc || inc.tipo !== TipoOrganizacao.INCORPORADORA) {
        throw new BadRequestException('Selecione uma incorporadora válida');
      }
    }
    return {
      codigo: dto.codigo.trim().toUpperCase(),
      nome: dto.nome.trim(),
      endereco: dto.endereco?.trim() || null,
      construtoraId: dto.construtoraId,
      incorporadoraId: dto.incorporadoraId || null,
      ativo: dto.ativo ?? true,
    };
  }

  @Post('empreendimentos')
  @Perfis(Perfil.INCORPORADORA)
  async criarEmpreendimento(@Body() dto: EmpreendimentoDto, @Ctx() ctx: Contexto) {
    const data = await this.validarEmpreendimento(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const emp = await tx.empreendimento.create({ data });
        await this.registrar(ctx, 'EMPREENDIMENTO_CRIADO', `Empreendimento ${emp.nome} (${emp.codigo}) cadastrado`, 'Empreendimento', emp.id, null, data, tx);
        return emp;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um empreendimento com este código');
      throw erro;
    }
  }

  @Patch('empreendimentos/:id')
  @Perfis(Perfil.INCORPORADORA)
  async editarEmpreendimento(@Param('id') id: string, @Body() dto: EmpreendimentoDto, @Ctx() ctx: Contexto) {
    const antes = await this.prisma.empreendimento.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Empreendimento não encontrado');
    const data = await this.validarEmpreendimento(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const emp = await tx.empreendimento.update({ where: { id }, data });
        await this.registrar(ctx, 'EMPREENDIMENTO_ALTERADO', `Empreendimento ${emp.nome} (${emp.codigo}) alterado`, 'Empreendimento', id, antes, data, tx);
        return emp;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um empreendimento com este código');
      throw erro;
    }
  }

  // ---------- clientes ----------

  @Get('clientes')
  @Perfis(Perfil.INCORPORADORA, Perfil.RELACIONAMENTO)
  clientes(@Query('busca') busca?: string) {
    const termo = busca?.trim().slice(0, 80);
    return this.prisma.cliente.findMany({
      where: termo
        ? {
            OR: [
              { nome: { contains: termo, mode: 'insensitive' } },
              ...(soDigitos(termo) ? [{ cpfCnpj: { contains: soDigitos(termo) } }] : []),
            ],
          }
        : {},
      include: { _count: { select: { unidades: true } } },
      orderBy: { nome: 'asc' },
      take: 500,
    });
  }

  private validarCliente(dto: ClienteDto) {
    const cpfCnpj = soDigitos(dto.cpfCnpj);
    if (!cpfCnpjValido(cpfCnpj)) throw new BadRequestException('CPF/CNPJ inválido');
    return {
      nome: dto.nome.trim(),
      cpfCnpj,
      email: dto.email?.trim().toLowerCase() || null,
      telefone: dto.telefone?.trim() || null,
    };
  }

  @Post('clientes')
  @Perfis(Perfil.INCORPORADORA, Perfil.RELACIONAMENTO)
  async criarCliente(@Body() dto: ClienteDto, @Ctx() ctx: Contexto) {
    const data = this.validarCliente(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cliente = await tx.cliente.create({ data });
        await this.registrar(ctx, 'CLIENTE_CRIADO', `Cliente ${cliente.nome} cadastrado`, 'Cliente', cliente.id, null, data, tx);
        return cliente;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um cliente com este CPF/CNPJ');
      throw erro;
    }
  }

  @Patch('clientes/:id')
  @Perfis(Perfil.INCORPORADORA, Perfil.RELACIONAMENTO)
  async editarCliente(@Param('id') id: string, @Body() dto: ClienteDto, @Ctx() ctx: Contexto) {
    const antes = await this.prisma.cliente.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Cliente não encontrado');
    const data = this.validarCliente(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cliente = await tx.cliente.update({ where: { id }, data });
        await this.registrar(ctx, 'CLIENTE_ALTERADO', `Cadastro do cliente ${cliente.nome} alterado`, 'Cliente', id, antes, data, tx);
        return cliente;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um cliente com este CPF/CNPJ');
      throw erro;
    }
  }

  // ---------- usuários ----------

  @Get('usuarios')
  @Perfis(Perfil.ADMINISTRADOR)
  usuarios() {
    return this.prisma.usuario.findMany({ select: USUARIO_PUBLICO, orderBy: { nome: 'asc' } });
  }

  private async validarUsuario(dto: UsuarioDto) {
    const cpf = soDigitos(dto.cpf) || null;
    if (cpf && !cpfValido(cpf)) throw new BadRequestException('CPF inválido');
    if (dto.perfil === Perfil.CONSTRUTORA && !dto.organizacaoId) {
      throw new BadRequestException(
        'Usuário de construtora precisa estar ligado à construtora dele — é o que define quais unidades ele vê',
      );
    }
    if (dto.organizacaoId) {
      const org = await this.prisma.organizacao.findUnique({ where: { id: dto.organizacaoId } });
      if (!org) throw new BadRequestException('Organização não encontrada');
      const esperado: Partial<Record<Perfil, TipoOrganizacao>> = {
        CONSTRUTORA: TipoOrganizacao.CONSTRUTORA,
        INCORPORADORA: TipoOrganizacao.INCORPORADORA,
        RELACIONAMENTO: TipoOrganizacao.CENTRAL_RELACIONAMENTO,
      };
      if (esperado[dto.perfil] && esperado[dto.perfil] !== org.tipo) {
        throw new BadRequestException('A organização escolhida não corresponde ao perfil do usuário');
      }
    }
    return {
      nome: dto.nome.trim(),
      email: dto.email.trim().toLowerCase(),
      cpf,
      perfil: dto.perfil,
      organizacaoId: dto.organizacaoId || null,
      ativo: dto.ativo ?? true,
      contaTeste: dto.contaTeste ?? false,
    };
  }

  @Post('usuarios')
  @Perfis(Perfil.ADMINISTRADOR)
  async criarUsuario(@Body() dto: UsuarioDto, @Ctx() ctx: Contexto) {
    if (!dto.senha) throw new BadRequestException('Informe a senha inicial');
    const data = await this.validarUsuario(dto);
    const senhaHash = await bcrypt.hash(dto.senha, 10);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({ data: { ...data, senhaHash }, select: USUARIO_PUBLICO });
        await this.registrar(ctx, 'USUARIO_CRIADO', `Usuário ${usuario.nome} (${usuario.perfil}) cadastrado`, 'Usuario', usuario.id, null, data, tx);
        return usuario;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um usuário com este e-mail');
      throw erro;
    }
  }

  @Patch('usuarios/:id')
  @Perfis(Perfil.ADMINISTRADOR)
  async editarUsuario(@Param('id') id: string, @Body() dto: UsuarioDto, @Ctx() ctx: Contexto) {
    const antes = await this.prisma.usuario.findUnique({ where: { id }, select: USUARIO_PUBLICO });
    if (!antes) throw new NotFoundException('Usuário não encontrado');
    const data = await this.validarUsuario(dto);
    if (id === ctx.usuario.sub && (!data.ativo || data.perfil !== Perfil.ADMINISTRADOR)) {
      throw new BadRequestException('Você não pode desativar nem rebaixar o seu próprio usuário');
    }
    const senhaHash = dto.senha ? await bcrypt.hash(dto.senha, 10) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.update({
          where: { id },
          data: { ...data, ...(senhaHash ? { senhaHash } : {}) },
          select: USUARIO_PUBLICO,
        });
        await this.registrar(
          ctx,
          'USUARIO_ALTERADO',
          `Usuário ${usuario.nome} alterado${senhaHash ? ' (senha redefinida)' : ''}`,
          'Usuario',
          id,
          antes,
          { ...data, senhaRedefinida: !!senhaHash },
          tx,
        );
        return usuario;
      });
    } catch (erro) {
      if (unicoViolado(erro)) throw new ConflictException('Já existe um usuário com este e-mail');
      throw erro;
    }
  }

  // ---------- pauta de vistoria ----------

  @Get('pauta')
  pauta(@Query('etapa') etapa?: string) {
    return this.prisma.modeloItem.findMany({
      where: etapa && etapa in Etapa ? { etapa: etapa as Etapa } : {},
      orderBy: [{ etapa: 'asc' }, { ordem: 'asc' }, { ambiente: 'asc' }],
    });
  }

  @Post('pauta')
  @Perfis(Perfil.ADMINISTRADOR)
  criarItem(@Body() dto: ModeloItemDto, @Ctx() ctx: Contexto) {
    const data = {
      etapa: dto.etapa,
      ambiente: dto.ambiente.trim(),
      descricao: dto.descricao.trim(),
      ordem: dto.ordem ?? 0,
      ativo: dto.ativo ?? true,
    };
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.modeloItem.create({ data });
      await this.registrar(ctx, 'PAUTA_ITEM_CRIADO', `Item de pauta criado: ${item.ambiente} · ${item.descricao}`, 'ModeloItem', item.id, null, data, tx);
      return item;
    });
  }

  @Patch('pauta/:id')
  @Perfis(Perfil.ADMINISTRADOR)
  async editarItem(@Param('id') id: string, @Body() dto: ModeloItemDto, @Ctx() ctx: Contexto) {
    const antes = await this.prisma.modeloItem.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Item não encontrado');
    const data = {
      etapa: dto.etapa,
      ambiente: dto.ambiente.trim(),
      descricao: dto.descricao.trim(),
      ordem: dto.ordem ?? antes.ordem,
      ativo: dto.ativo ?? antes.ativo,
    };
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.modeloItem.update({ where: { id }, data });
      await this.registrar(ctx, 'PAUTA_ITEM_ALTERADO', `Item de pauta alterado: ${item.ambiente} · ${item.descricao}`, 'ModeloItem', id, antes, data, tx);
      return item;
    });
  }
}
