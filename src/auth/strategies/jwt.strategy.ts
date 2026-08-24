/* System Package */
import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

/* Application Package */
import { IAuthUser, IJwtPayload } from "../interfaces/jwt.interface";

/**
 * Registered under the explicit name 'jwt' — the same name AtGuard resolves.
 * Naming it here rather than relying on passport-jwt's implicit default makes
 * a second strategy silently overwriting this one impossible to miss.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request): string | null => {
          // cookie-parser types its bag as Record<string, any> and
          // JSON-decodes any value prefixed with 'j:', so this
          // client-controlled value is not guaranteed to be a string.
          const cookies = request?.cookies as
            | Record<string, string | undefined>
            | undefined;
          const token = cookies?.['access_token'];

          return typeof token === 'string' && token.length > 0 ? token : null;
        },
      ]),
      ignoreExpiration: false,
      // Pinned so a token cannot dictate how it gets verified.
      algorithms: ['HS256'],
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: IJwtPayload): IAuthUser {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      // Passed through so /auth/me can report the access token's expiry without
      // the controller having to re-read and decode the cookie itself.
      exp: payload.exp,
    };
  }
}
