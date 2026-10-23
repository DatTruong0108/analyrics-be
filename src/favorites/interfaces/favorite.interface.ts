/* Application Package */
import { ISongMetadata } from "src/analysis/interfaces/analysis.interface";

/**
 * One row of a user's favourites: the song plus when it was favourited.
 * `favoritedAt` is `Favorite.createdAt`; re-adding a favourite does not bump it.
 */
export interface IFavoriteItem extends ISongMetadata {
  favoritedAt: Date;
}

export interface IUserFavorites {
  items: IFavoriteItem[];
  total: number;
}
