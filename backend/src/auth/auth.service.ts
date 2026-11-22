import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Perfil, TipoAtor, TipoOrganizacao } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Contexto, UsuarioLogado } from '../comum/contexto';
import { PrismaService } from '../prisma/prisma.service';
import { contasDeTesteLigadas, nomeDeTeste } from './guards';

// Hash de mentira para gastar o mesmo tempo quando o e-mail não existe —
// sem isso o tempo de resposta revela quais e-mails têm cadastro.
const HASH_ISCA = bcrypt.hashSync('sem-usuario', 10);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private auditoria: AuditoriaService,
  ) {}

  async login(
    email: string,
    senha: string,
    origem: { ip: string | null; userAgent: string | null },
  ) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { organizacao: true },
    });
    const confere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_ISCA);
    if (!usuario || !usuario.ativo || !confere) {
      await this.auditoria.registrar({
        acao: 'LOGIN_RECUSADO',
        descricao: `Tentativa de login recusada para ${email.trim().toLowerCase().slice(0, 120)}`,
        entidade: 'Usuario',
        entidadeId: usuario?.id,
        ator: {
          tipo: TipoAtor.SISTEMA,
          nome: 'Não autenticado',
          ...origem,
        },
      });
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const deTeste = usuario.contaTeste && contasDeTesteLigadas();
    const payload: UsuarioLogado = {
      sub: usuario.id,
      nome: deTeste ? nomeDeTeste(usuario.nome) : usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      organizacaoId: usuario.organizacaoId,
      organizacaoNome: usuario.organizacao?.nome ?? null,
      ...(deTeste ? { contaTeste: true, perfilReal: usuario.perfil } : {}),
    };
    await this.auditoria.registrar({
      acao: 'LOGIN',
      descricao: `${usuario.nome} entrou no sistema`,
      entidade: 'Usuario',
      entidadeId: usuario.id,
      ator: {
        tipo: TipoAtor.USUARIO,
        id: usuario.id,
        nome: usuario.nome,
        perfil: usuario.perfil,
        organizacao: payload.organizacaoNome,
        ...origem,
      },
    });
    return { accessToken: await this.jwt.signAsync({ sub: usuario.id }), usuario: payload };
  }

  // ---------- conta de teste: "Ver como" ----------

  private exigirContaDeTeste(ctx: Contexto) {
    if (!ctx.usuario.contaTeste) {
      throw new ForbiddenException(
        contasDeTesteLigadas()
          ? 'Só uma conta de teste pode trocar de perfil'
          : 'As contas de teste estão desligadas neste servidor (CONTAS_DE_TESTE)',
      );
    }
  }

  // Os perfis que a conta de teste pode assumir. A construtora aparece uma
  // vez por empresa: é a empresa que define quais unidades ela enxerga.
  async perfisDeTeste(ctx: Contexto) {
    this.exigirContaDeTeste(ctx);
    const orgs = await this.prisma.organizacao.findMany({
      where: { ativo: true },
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    });
    const doTipo = (tipo: TipoOrganizacao) => orgs.filter((o) => o.tipo === tipo);
    const primeira = (tipo: TipoOrganizacao) => doTipo(tipo)[0]?.id ?? null;
    return [
      { perfil: Perfil.ADMINISTRADOR, organizacaoId: null, rotulo: 'Administrador' },
      { perfil: Perfil.INCORPORADORA, organizacaoId: primeira(TipoOrganizacao.INCORPORADORA), rotulo: 'Incorporadora' },
      ...doTipo(TipoOrganizacao.CONSTRUTORA).map((o) => ({
        perfil: Perfil.CONSTRUTORA,
        organizacaoId: o.id,
        rotulo: `Construtora — ${o.nome}`,
      })),
      { perfil: Perfil.RELACIONAMENTO, organizacaoId: primeira(TipoOrganizacao.CENTRAL_RELACIONAMENTO), rotulo: 'Central de Relacionamento' },
      { perfil: Perfil.AUDITOR, organizacaoId: null, rotulo: 'Auditor (só leitura)' },
    ];
  }

  async verComo(ctx: Contexto, perfil: Perfil, organizacaoId: string | null) {
    this.exigirContaDeTeste(ctx);
    const opcoes = await this.perfisDeTeste(ctx);
    const opcao = opcoes.find((o) => o.perfil === perfil && (o.organizacaoId ?? null) === (organizacaoId ?? null));
    if (!opcao) throw new BadRequestException('Perfil de teste inválido');
    await this.auditoria.registrar({
      acao: 'CONTA_TESTE_VER_COMO',
      descricao: `${ctx.usuario.nome} passou a ver o sistema como ${opcao.rotulo}`,
      entidade: 'Usuario',
      entidadeId: ctx.usuario.sub,
      ator: ctx.ator,
    });
    const org = opcao.organizacaoId
      ? await this.prisma.organizacao.findUnique({ where: { id: opcao.organizacaoId } })
      : null;
    const usuario: UsuarioLogado = {
      ...ctx.usuario,
      perfil,
      organizacaoId: org?.id ?? null,
      organizacaoNome: org?.nome ?? null,
    };
    return {
      accessToken: await this.jwt.signAsync({ sub: ctx.usuario.sub, verComo: { perfil, organizacaoId: org?.id ?? null } }),
      usuario,
    };
  }

  async trocarSenha(ctx: Contexto, senhaAtual: string, novaSenha: string) {
    const confere = await this.conferirSenha(ctx.usuario.sub, senhaAtual);
    await this.auditoria.registrar({
      acao: confere ? 'SENHA_ALTERADA' : 'SENHA_ALTERACAO_RECUSADA',
      descricao: confere
        ? `${ctx.usuario.nome} alterou a própria senha`
        : `Senha atual incorreta na tentativa de troca de senha de ${ctx.usuario.nome}`,
      entidade: 'Usuario',
      entidadeId: ctx.usuario.sub,
      ator: ctx.ator,
    });
    if (!confere) throw new ForbiddenException('Senha atual incorreta');
    await this.prisma.usuario.update({
      where: { id: ctx.usuario.sub },
      data: { senhaHash: await bcrypt.hash(novaSenha, 10) },
    });
    return { ok: true };
  }

  // Confere a senha do usuário logado — pedido de novo no ato de assinar
  async conferirSenha(usuarioId: string, senha: string): Promise<boolean> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (!usuario || !usuario.ativo) return false;
    return bcrypt.compare(senha, usuario.senhaHash);
  }
}
