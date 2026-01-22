/* System Package */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';

/* Application Package */
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

  app.setGlobalPrefix('api');

  app.use(cookieParser());

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Analyrics API')
    .setDescription('Tài liệu API cho hệ thống phân tích lời bài hát thông minh')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/api/docs', app, document);

  await app.listen(port);
  logger.log(`🚀 Ứng dụng Analyrics đang chạy tại: http://localhost:${port}/api`);
  logger.log(`📖 Tài liệu Swagger: http://localhost:${port}/api/docs`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();