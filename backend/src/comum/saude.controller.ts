import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Para o monitoramento e o healthcheck do Docker: responde 200 só quando a
// API consegue falar com o banco.
@Controller('saude')
export class SaudeController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async saude() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível');
    }
    return { ok: true, hora: new Date().toISOString() };
  }
}
