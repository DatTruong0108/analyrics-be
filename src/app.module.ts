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
  parseDurationToMs,
  isUsableJwtExpiresIn,
} from './auth/utils/jwt-expiry.util';
import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL,
  THROTTLE_ERROR_MESSAGE,
} from './shared/constants/throttle';

/**
 * The slice of validated configuration the cross-key rule below reads. The
 * index signature keeps it honest: Joi hands the *whole* env object to an
 * object-level `custom`, not just these two keys.
 */
interface ValidatedEnv {
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_EXPIRES_IN: string;
  [key: string]: string | number;
}

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
  /*
   * Same grammar as JWT_EXPIRES_IN, and deliberately `required()` with no
   * default: the refresh cookie's `maxAge` is derived from this value, so a
   * silent fallback would mean sessions quietly expiring on a schedule nobody
   * configured. Failing at boot is the cheaper failure.
   */
  REFRESH_TOKEN_EXPIRES_IN: Joi.string()
    .custom((value: string, helpers: Joi.CustomHelpers<string>) =>
      isUsableJwtExpiresIn(value) ? value : helpers.error('any.invalid'),
    )
    .required(),
  PORT: Joi.number().default(3001),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  /*
   * Both are required, not just whichever one matches NODE_ENV: main.ts picks
   * between them and passes the result straight into
   * `enableCors({ origin: [frontendUrl] })`. An unset value makes that
   * `[undefined]`, which rejects every credentialed preflight — a failure that
   * surfaces to users as "login is broken", a long way from its real cause.
   *
   * The scheme is pinned because a bare `localhost:3000` satisfies Joi's
   * default `uri()` — it parses as scheme `localhost` — and would sail through
   * validation only to produce an origin no browser will ever match.
   */
  FE_URL: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  FE_URL_PROD: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
})
  /*
   * Cross-key rule: a refresh token that dies before the access token it is
   * meant to renew makes the whole rotation scheme pointless — the user is
   * logged out while still holding a valid access token, which reads as a
   * random session drop rather than as a misconfiguration.
   *
   * Joi skips an object-level `custom` when any key failed its own rules, so
   * both values are already known-parsable here and `parseDurationToMs` cannot
   * throw.
   *
   * `helpers.message` rather than a schema-level `.messages({ 'any.invalid' })`:
   * object-level messages are inherited by child keys, so overriding
   * `any.invalid` here would relabel a bad JWT_EXPIRES_IN with this rule's
   * text — pointing a reader at the wrong variable entirely.
   */
  .custom((env: ValidatedEnv, helpers: Joi.CustomHelpers<ValidatedEnv>) =>
    parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN) <=
    parseDurationToMs(env.JWT_EXPIRES_IN)
      ? helpers.message({
          custom:
            'REFRESH_TOKEN_EXPIRES_IN phải dài hơn JWT_EXPIRES_IN ' +
            `(hiện tại: ${env.REFRESH_TOKEN_EXPIRES_IN} so với ${env.JWT_EXPIRES_IN}).`,
        })
      : env,
  );

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
