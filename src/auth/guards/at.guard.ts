/* System Package */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AtGuard extends AuthGuard('jwt') {
  // Ghi đè hàm xử lý lỗi để không chặn người dùng khách
  handleRequest(err: any, user: any): any {
    if (err || !user) {
      return null; // Trả về null thay vì ném ra lỗi 401
    }
    return user;
  }
}