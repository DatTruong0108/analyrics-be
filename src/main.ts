/* System Package */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';

/* Application Package */
import { AppModule } from './app.module';
import { VALIDATION_PIPE_OPTIONS } from './shared/constants/validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;
  const frontendUrl = configService.get<string>('NODE_ENV') === "development" ? configService.get<string>('FE_URL') : configService.get<string>('FE_URL_PROD');

  app.setGlobalPrefix('api');

  app.use(cookieParser());

  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  const config = new DocumentBuilder()
    .setTitle('Analyrics API')
    .setDescription('Tài liệu API cho hệ thống phân tích lời bài hát thông minh')
    .setVersion('2.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/api/docs', app, document);

  await app.listen(port);
  logger.log(`🚀 Ứng dụng Analyrics đang chạy tại: ${process.env.NODE_ENV==="production" ? process.env.BE_URL_PROD : `http://localhost:${port}`}`);
  logger.log(`📖 Tài liệu Swagger: ${process.env.NODE_ENV==="production" ? `${process.env.BE_URL_PROD}/api/docs` : `http://localhost:${port}/api/docs`}`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();