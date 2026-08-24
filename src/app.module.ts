/* System Package */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';

/* Application Package */
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AnalysisModule } from './analysis/analysis.module';
import {
  DEFAULT_JWT_EXPIRES_IN,
  isUsableJwtExpiresIn,
} from './auth/utils/jwt-expiry.util';
import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL,
  THROTTLE_ERROR_MESSAGE,
} from './shared/constants/throttle';

/**
 * Exported so the rules below are directly testable — an inline schema is
 * only exercised by booting the whole application, which needs a database.
 */
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  // Duration string such as '7d' / '30m', or a bare number of seconds.
  // Validated against what `ms` really parses, so a value that would break
  // token signing stops startup instead of failing on every login.
  JWT_EXPIRES_IN: Joi.string()
    .custom((value: string, helpers: Joi.CustomHelpers<string>) =>
      isUsableJwtExpiresIn(value) ? value : helpers.error('any.invalid'),
    )
    .default(DEFAULT_JWT_EXPIRES_IN),
  PORT: Joi.number().default(3001),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Baseline budget for every route. Individual handlers tighten it with
    // @Throttle; the guard keys each budget per controller + handler + client,
    // so routes do not share a bucket.
    ThrottlerModule.forRoot({
      throttlers: [
        { limit: DEFAULT_THROTTLE_LIMIT, ttl: DEFAULT_THROTTLE_TTL },
      ],
      errorMessage: THROTTLE_ERROR_MESSAGE,
    }),
    PrismaModule, 
    AuthModule,
    AnalysisModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
