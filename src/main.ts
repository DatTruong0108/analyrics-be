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
import { resolveAllowedOrigins } from './shared/config/allowed-origins';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;
  /*
   * One list, two enforcers: CORS below decides what a browser may *read*, and
   * OriginCheckMiddleware decides what this server will *act on*. They must
   * agree, so both read it from the same place — see the note in that module on
   * why drift here fails silently in the dangerous direction.
   */
  const allowedOrigins = resolveAllowedOrigins(configService);

  app.setGlobalPrefix('api');

  app.use(cookieParser());

  app.enableCors({
    origin: allowedOrigins,
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
    /*
     * Cookie auth, not bearer. `JwtStrategy` only ever reads the `access_token`
     * cookie — it has no Authorization-header extractor — so the previous
     * `.addBearerAuth()` rendered an Authorize button that could not possibly
     * work, and no route ever referenced it. Naming the scheme here is also
     * what makes `@ApiCookieAuth()` on the auth routes resolve.
     */
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
    })
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