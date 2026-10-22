/* System Package */
import { ConfigService } from '@nestjs/config';

/**
 * The single allowlist of browser origins permitted to talk to this API.
 *
 * Shared deliberately. `enableCors` and `OriginCheckMiddleware` are two halves
 * of one policy — CORS decides what the browser may *read*, the middleware
 * decides what the server will *act on* — and if the two lists ever drift, the
 * failure is silent in the worst direction: a state-changing request that CORS
 * would have blocked still gets executed, its response merely unreadable. The
 * side effect has already happened by then.
 *
 * `getOrThrow`, not `get`: an `undefined` in the allowlist rejects every
 * credentialed preflight, which presents to users as "login is broken" rather
 * than as a config error. Joi already makes both keys required, so this only
 * fires if the two drift apart — and failing at boot is far cheaper than
 * debugging it in a browser.
 *
 * Note the branch is on `development` specifically, not on "not production":
 * NODE_ENV may also be `test`, which takes the production URL. That is the
 * pre-existing behaviour and is preserved here on purpose.
 */
export function resolveAllowedOrigins(configService: ConfigService): string[] {
  const frontendUrl =
    configService.get<string>('NODE_ENV') === 'development'
      ? configService.getOrThrow<string>('FE_URL')
      : configService.getOrThrow<string>('FE_URL_PROD');

  return [frontendUrl];
}
