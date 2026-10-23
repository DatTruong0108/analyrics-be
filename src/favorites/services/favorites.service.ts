/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";

/* Application Package */
import { IFavoritesRepository } from "../repositories/favorites.repository";
import { IFavoriteItem } from "../interfaces/favorite.interface";

@Injectable()
export class FavoritesService {
  constructor(private readonly repository: IFavoritesRepository) { }

  /** Ok(false) means the song does not exist; the controller reports that as 404. */
  async addFavorite(userId: string, songId: string): Promise<Result<boolean, string>> {
    return await this.repository.addFavorite(userId, songId);
  }

  async removeFavorite(userId: string, songId: string): Promise<Result<void, string>> {
    return await this.repository.removeFavorite(userId, songId);
  }

  /** One page of the caller's favourites, newest first. Same paging contract as history. */
  async getFavorites(userId: string, limit: number, offset: number): Promise<Result<{ items: IFavoriteItem[]; total: number; hasMore: boolean }, string>> {
    const result = await this.repository.findFavorites(userId, limit, offset);

    if (result.isErr()) return Err(result.unwrapErr());

    const { items, total } = result.unwrap();

    return Ok({ items, total, hasMore: offset + items.length < total });
  }

  /**
   * Whether the caller has favourited the song, for GET /favorites/:songId.
   * Unlike `isFavorited`, a lookup failure is reported: this endpoint exists
   * only to answer that question, so guessing `false` would be a wrong answer.
   */
  async getFavoriteState(userId: string, songId: string): Promise<Result<boolean, string>> {
    return await this.repository.isFavorited(userId, songId);
  }

  /**
   * Whether the caller has favourited the song, for the analyze response.
   *
   * Never fails: the heart icon is secondary to the analysis itself, so a
   * lookup error shows an empty heart rather than turning a good analysis into
   * an error page. A guest has no favourites by definition.
   */
  async isFavorited(userId: string | null, songId: string): Promise<boolean> {
    if (!userId) return false;

    const result = await this.repository.isFavorited(userId, songId);

    return result.unwrapOr(false);
  }
}
