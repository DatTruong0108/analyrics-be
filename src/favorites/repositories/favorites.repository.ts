/* System Package */
import { Result } from "oxide.ts";

/* Application Package */
import { IUserFavorites } from "../interfaces/favorite.interface";

export abstract class IFavoritesRepository {
  /** Ok(false) when the song does not exist, so there is nothing to favourite. */
  abstract addFavorite(userId: string, songId: string): Promise<Result<boolean, string>>;
  abstract removeFavorite(userId: string, songId: string): Promise<Result<void, string>>;
  abstract findFavorites(userId: string, limit: number, offset: number): Promise<Result<IUserFavorites, string>>;
  abstract isFavorited(userId: string, songId: string): Promise<Result<boolean, string>>;
}
