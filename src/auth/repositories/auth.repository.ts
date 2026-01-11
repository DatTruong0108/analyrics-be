/* System Package */
import { Result } from 'oxide.ts';

/* Application Package */
import { IUser } from '../interfaces/auth.interface';
import { RegisterDto } from '../auth.dto';

export abstract class IAuthRepository {
  abstract findByEmail(email: string): Promise<Result<IUser | null, string>>;
  abstract createUser(data: RegisterDto, hashedPass: string): Promise<Result<IUser, string>>;
}