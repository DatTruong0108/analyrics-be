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
import { AtStrategy } from './strategies/at.strategy';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: parseInt(configService.get<string>('JWT_EXPIRES_IN')!),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    AtStrategy,
    JwtStrategy,
    {
      provide: IAuthRepository,
      useClass: AuthRepositoryImpl,
    },
  ],
  controllers: [AuthController]
})
export class AuthModule { }
