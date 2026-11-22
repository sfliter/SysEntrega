import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AgendamentosController } from './agendamentos/agendamentos.controller';
import { AgendamentosService } from './agendamentos/agendamentos.service';
import {
  AssinaturasController,
  WebhooksController,
} from './assinaturas/assinaturas.controller';
import { AssinaturasService } from './assinaturas/assinaturas.service';
import { EnvioService } from './assinaturas/envio.service';
import { RsfSignerProvedor } from './assinaturas/rsf-signer.provedor';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { AuditoriaService } from './auditoria/auditoria.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { LimiteGuard } from './auth/limite.guard';
import { CadastrosController } from './cadastros/cadastros.controller';
import { NotificacoesService } from './comum/notificacoes.service';
import { SaudeController } from './comum/saude.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { TermoPdfService } from './documentos/termo-pdf.service';
import { PrismaService } from './prisma/prisma.service';
import { PublicoController } from './publico/publico.controller';
import { UnidadesController } from './unidades/unidades.controller';
import { UnidadesService } from './unidades/unidades.service';
import { ArmazenamentoService } from './vistorias/armazenamento.service';
import { VistoriasController } from './vistorias/vistorias.controller';
import { VistoriasService } from './vistorias/vistorias.service';

function segredoJwt(): string {
  const segredo = process.env.JWT_SECRET;
  if (!segredo || segredo.length < 32) {
    // Sem segredo forte qualquer um forjaria uma sessão: melhor não subir
    throw new Error('Defina JWT_SECRET com ao menos 32 caracteres aleatórios');
  }
  return segredo;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: segredoJwt(),
        signOptions: { expiresIn: process.env.JWT_EXPIRA_EM || '10h' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    UnidadesController,
    AgendamentosController,
    VistoriasController,
    AssinaturasController,
    WebhooksController,
    PublicoController,
    CadastrosController,
    AuditoriaController,
    DashboardController,
    SaudeController,
  ],
  providers: [
    PrismaService,
    AuditoriaService,
    AuthService,
    EnvioService,
    NotificacoesService,
    JwtAuthGuard,
    RolesGuard,
    LimiteGuard,
    UnidadesService,
    AgendamentosService,
    ArmazenamentoService,
    TermoPdfService,
    RsfSignerProvedor,
    AssinaturasService,
    VistoriasService,
  ],
})
export class AppModule {}
