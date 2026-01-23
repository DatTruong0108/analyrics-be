/* System Package */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

/* Application Package */
import { IPayload } from '../interfaces/auth.interface';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      // Trích xuất JWT từ cookie có tên 'access_token'
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          return (req?.cookies?.access_token as string | null) || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.AT_SECRET || 'at-secret', // Đảm bảo trùng với bí mật lúc Sign Token
    });
  }

  // Sau khi giải mã thành công, nội dung Payload sẽ được đưa vào hàm này
  validate(payload: IPayload): IPayload {
    // Payload thường chứa { sub: id, email: ... }
    // Trả về đối tượng này để NestJS gắn vào request.user
    return payload; 
  }
}