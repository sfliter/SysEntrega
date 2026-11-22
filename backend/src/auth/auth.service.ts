import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TipoAtor } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuarioLogado } from '../comum/contexto';
import { PrismaService } from '../prisma/prisma.service';

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
    const payload: UsuarioLogado = {
      sub: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      organizacaoId: usuario.organizacaoId,
      organizacaoNome: usuario.organizacao?.nome ?? null,
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
    return { accessToken: await this.jwt.signAsync(payload), usuario: payload };
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
