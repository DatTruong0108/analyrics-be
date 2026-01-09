/* eslint-disable @typescript-eslint/no-floating-promises */

/* System Package */
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/* Application Package */
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Analyrics API')
    .setDescription('The music analysis API description')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe()); // Bật validation cho DTO

  app.enableCors({
    origin: [process.env.FE_URL],
    credentials: true, // Cho phép gửi cookie
  });

  await app.listen(process.env.PORT || 3001);
}
bootstrap();
