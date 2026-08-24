/* System Package */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/* Application Package */
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { IAuthRepository } from './repositories/auth.repository';
import { AuthRepositoryImpl } from './repositories/auth.repository.impl';
import { IRefreshTokenRepository } from './repositories/refresh-token.repository';
import { RefreshTokenRepositoryImpl } from './repositories/refresh-token.repository.impl';
import { resolveJwtExpiresIn } from './utils/jwt-expiry.util';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: resolveJwtExpiresIn(
            configService.get<string>('JWT_EXPIRES_IN'),
          ),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: IAuthRepository,
      useClass: AuthRepositoryImpl,
    },
    {
      provide: IRefreshTokenRepository,
      useClass: RefreshTokenRepositoryImpl,
    },
  ],
  controllers: [AuthController]
})
export class AuthModule { }
