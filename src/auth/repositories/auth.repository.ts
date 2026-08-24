/* System Package */
import { Result } from 'oxide.ts';

/* Application Package */
import { IUser } from '../interfaces/auth.interface';
import { RegisterDto } from '../auth.dto';

export abstract class IAuthRepository {
  abstract findByEmail(email: string): Promise<Result<IUser | null, string>>;
  abstract createUser(data: RegisterDto, hashedPass: string): Promise<Result<IUser, string>>;
  /**
   * Needed by the refresh path: a rotation must re-read the user and sign the
   * new access token from current database state, never from claims copied out
   * of the token being replaced. Otherwise a role revoked mid-session would
   * keep being re-minted for as long as the family stays alive.
   */
  abstract findById(id: string): Promise<Result<IUser | null, string>>;
}