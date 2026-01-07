/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe()); // Bật validation cho DTO

  // Cấu hình CORS để Frontend gọi được API
  app.enableCors({
    origin: process.env.FE_URL, // URL của Next.js
    credentials: true, // Cho phép gửi cookie
  });

  await app.listen(process.env.PORT || 3001);
}
bootstrap();
