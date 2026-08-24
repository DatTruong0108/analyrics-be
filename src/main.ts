/* System Package */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';

/* Application Package */
import { AppModule } from './app.module';
import { VALIDATION_PIPE_OPTIONS } from './shared/constants/validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;
  /*
   * `getOrThrow`, not `get`: the CORS origin must be a string, and a `undefined`
   * slipping into the allowlist rejects every credentialed preflight — which
   * presents as "login is broken" rather than as a config error. The Joi schema
   * already makes both keys required, so this only ever fires if the two drift
   * apart; failing here at boot is far cheaper than debugging it in the browser.
   */
  const frontendUrl = configService.get<string>('NODE_ENV') === "development"
    ? configService.getOrThrow<string>('FE_URL')
    : configService.getOrThrow<string>('FE_URL_PROD');

  app.setGlobalPrefix('api');

  app.use(cookieParser());

  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    /*
     * `X-Token-Expired` is a custom response header, so it is invisible to
     * cross-origin JS unless it is named here: the fetch spec exposes only
     * the CORS-safelisted response headers by default. Without this the
     * frontend cannot tell "access token expired, refresh it" apart from
     * "genuinely a guest", and would silently treat every logged-in user as
     * anonymous once their token ages out.
     */
    exposedHeaders: ['X-Token-Expired'],
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

  /*
   * Render terminates TLS at its proxy, so without this every request
   * reports the proxy's address as `req.ip` and ThrottlerGuard buckets the
   * entire internet together. `1` trusts exactly one hop — the platform's
   * own proxy — so a client cannot spoof its way into a private bucket by
   * sending its own X-Forwarded-For.
   */
  app.set('trust proxy', 1);
  await app.listen(port);
  logger.log(`🚀 Ứng dụng Analyrics đang chạy tại: ${process.env.NODE_ENV==="production" ? process.env.BE_URL_PROD : `http://localhost:${port}`}`);
  logger.log(`📖 Tài liệu Swagger: ${process.env.NODE_ENV==="production" ? `${process.env.BE_URL_PROD}/api/docs` : `http://localhost:${port}/api/docs`}`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();