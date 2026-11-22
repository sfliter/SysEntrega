import { Injectable, Logger } from '@nestjs/common';
import { Etapa, Perfil, StatusUnidade } from '@prisma/client';
import { EnvioService } from '../assinaturas/envio.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ATOR_SISTEMA } from './contexto';
import { ETAPAS, ROTULO_STATUS } from './fluxo';
import { PrismaService } from '../prisma/prisma.service';

// Aviso por e-mail a quem precisa agir quando a unidade muda de situação.
//
// Liga com NOTIFICAR_POR_EMAIL=1 (e SMTP configurado). É melhor esforço: se
// o e-mail falhar, o processo segue — o painel "Aguardando você" continua
// sendo a fila de trabalho de cada um. Os avisos não levam dados do cliente.
@Injectable()
export class NotificacoesService {
  private log = new Logger('Notificacoes');

  constructor(
    private prisma: PrismaService,
    private envio: EnvioService,
    private auditoria: AuditoriaService,
  ) {}

  ligado(): boolean {
    return process.env.NOTIFICAR_POR_EMAIL === '1' && this.envio.emailConfigurado();
  }

  // Quem precisa agir (ou saber) em cada situação
  private destinatarios(etapa: Etapa, status: StatusUnidade): { perfis: Perfil[]; acao: string } {
    const cfg = ETAPAS[etapa];
    const partes = [cfg.cedente, cfg.recebedor].filter(Boolean) as Perfil[];
    switch (status) {
      case StatusUnidade.AGUARDANDO_LIBERACAO:
        return { perfis: [cfg.cedente], acao: 'A unidade aguarda a sua liberação.' };
      case StatusUnidade.AGUARDANDO_AGENDAMENTO:
        return { perfis: cfg.propoeHorarios, acao: 'Falta combinar a data da vistoria.' };
      case StatusUnidade.VISTORIA_AGENDADA:
        return { perfis: partes, acao: 'A vistoria foi agendada.' };
      case StatusUnidade.AGUARDANDO_CONFERENCIA:
        return { perfis: [cfg.vistoriador], acao: 'A unidade aguarda a sua conferência.' };
      case StatusUnidade.COM_PENDENCIAS:
        return { perfis: cfg.resolvePendencias, acao: 'Há pendências a sanar antes de nova vistoria.' };
      case StatusUnidade.AGUARDANDO_ASSINATURA:
        return { perfis: partes, acao: 'O termo foi emitido e aguarda a sua assinatura.' };
      case StatusUnidade.ENTREGUE:
        return { perfis: [Perfil.INCORPORADORA, Perfil.RELACIONAMENTO], acao: 'A unidade foi entregue ao cliente.' };
      default:
        return { perfis: [], acao: '' };
    }
  }

  // Chamado quando a situação muda. O envio acontece um instante depois,
  // fora da transação, e só se a mudança tiver sido de fato gravada.
  aoMudarEstado(unidadeId: string, etapa: Etapa, status: StatusUnidade) {
    if (!this.ligado()) return;
    setTimeout(() => {
      this.enviarSeConfirmado(unidadeId, etapa, status).catch((erro) =>
        this.log.error(`Aviso não enviado: ${(erro as Error).message}`),
      );
    }, 1500).unref();
  }

  private async enviarSeConfirmado(unidadeId: string, etapa: Etapa, status: StatusUnidade) {
    const unidade = await this.prisma.unidade.findUnique({
      where: { id: unidadeId },
      include: { empreendimento: true },
    });
    // A transação foi desfeita, ou a unidade já andou de novo: nada a avisar
    if (!unidade || unidade.etapa !== etapa || unidade.status !== status) return;
    const { perfis, acao } = this.destinatarios(etapa, status);
    if (!perfis.length) return;
    await this.avisar(unidadeId, etapa, perfis, ROTULO_STATUS[status], acao);
  }

  async avisar(unidadeId: string, etapa: Etapa, perfis: Perfil[], assunto: string, texto: string) {
    if (!this.ligado()) return;
    const unidade = await this.prisma.unidade.findUnique({
      where: { id: unidadeId },
      include: { empreendimento: true },
    });
    if (!unidade) return;
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        ativo: true,
        OR: perfis.map((perfil) =>
          // A construtora só recebe avisos das obras dela
          perfil === Perfil.CONSTRUTORA
            ? { perfil, organizacaoId: unidade.empreendimento.construtoraId }
            : { perfil },
        ),
      },
      select: { email: true },
    });
    if (!usuarios.length) return;
    const rotulo = unidade.bloco ? `${unidade.bloco} · ${unidade.numero}` : unidade.numero;
    const site = (process.env.APP_URL || '').replace(/\/$/, '');
    let enviados = 0;
    for (const u of usuarios) {
      const ok = await this.envio.enviarLink(
        u.email,
        `[SysEntrega] ${unidade.empreendimento.nome} · ${rotulo}: ${assunto}`,
        `${unidade.empreendimento.nome} · unidade ${rotulo}\n` +
          `Etapa ${ETAPAS[etapa].ordem} — ${ETAPAS[etapa].rotulo.replace('→', 'para')}\n\n${texto}\n\n` +
          (site ? `Abrir a unidade: ${site}/unidades/${unidade.id}\n\n` : '') +
          'RSF · SysEntrega',
      );
      if (ok) enviados++;
    }
    await this.auditoria.registrar({
      acao: 'NOTIFICACAO_ENVIADA',
      descricao: `Aviso por e-mail "${assunto}" enviado a ${enviados} de ${usuarios.length} destinatário(s)`,
      entidade: 'Unidade',
      entidadeId: unidadeId,
      unidadeId,
      etapa,
      ator: ATOR_SISTEMA,
      dados: { perfis, enviados, destinatarios: usuarios.length },
    });
  }
}
