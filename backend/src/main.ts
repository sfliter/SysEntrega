import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: o webhook do rsf-signer confere o HMAC sobre os bytes recebidos
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // Atrás do nginx, req.ip seria o IP do container. O número é a quantidade
  // de proxies na frente da API (o nginx conta 1) — é o que faz o IP gravado
  // na auditoria e nas assinaturas ser o de quem agiu de verdade.
  app.set('trust proxy', Number(process.env.PROXIES_CONFIAVEIS) || 1);
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`RSF - SysEntrega API rodando na porta ${port}`);
}
bootstrap();
