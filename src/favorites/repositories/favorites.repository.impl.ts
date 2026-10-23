/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";
import { Prisma } from "@prisma/client";

/* Application Package */
import { IFavoritesRepository } from "./favorites.repository";
import { IFavoriteItem, IUserFavorites } from "../interfaces/favorite.interface";
import { PrismaService } from "src/prisma/prisma.service";

/** Foreign key violation: the songId does not match any Song row. */
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
/** Unique violation: a concurrent request inserted the same (userId, songId) first. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class FavoritesRepositoryImpl implements IFavoritesRepository {
  constructor(private readonly prismaService: PrismaService) { }

  /**
   * Idempotent: an existing favourite is left untouched (`update: {}`), so
   * adding twice keeps the original `createdAt` and the list order with it.
   */
  async addFavorite(userId: string, songId: string): Promise<Result<boolean, string>> {
    try {
      await this.prismaService.favorite.upsert({
        where: { userId_songId: { userId, songId } },
        update: {},
        create: { userId, songId },
      });

      return Ok(true);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_FOREIGN_KEY_VIOLATION) return Ok(false);
        // Two adds raced and the other one won: the song is favourited, which is what was asked.
        if (error.code === PRISMA_UNIQUE_VIOLATION) return Ok(true);
      }

      console.error('Add Favorite Error:', error);
      return Err('Lỗi khi thêm bài hát yêu thích.');
    }
  }

  /** Idempotent: removing a song that is not favourited deletes nothing and still succeeds. */
  async removeFavorite(userId: string, songId: string): Promise<Result<void, string>> {
    try {
      await this.prismaService.favorite.deleteMany({ where: { userId, songId } });

      return Ok(undefined);
    } catch (error) {
      console.error('Remove Favorite Error:', error);
      return Err('Lỗi khi xoá bài hát yêu thích.');
    }
  }

  async findFavorites(userId: string, limit: number, offset: number): Promise<Result<IUserFavorites, string>> {
    try {
      const [favorites, total] = await this.prismaService.$transaction([
        this.prismaService.favorite.findMany({
          where: { userId },
          take: limit,
          skip: offset,
          // Newest favourite first; id breaks ties so paging stays stable on equal timestamps.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { song: true },
        }),
        this.prismaService.favorite.count({ where: { userId } }),
      ]);

      const items: IFavoriteItem[] = favorites.map(record => ({
        id: record.song.id,
        title: record.song.title,
        artist: record.song.artist,
        album: record.song.album,
        imageUrl: record.song.imageUrl,
        spotifyUrl: record.song.spotifyUrl,
        previewUrl: record.song.previewUrl,
        favoritedAt: record.createdAt,
      }));

      return Ok({ items, total });
    } catch (error) {
      console.error('Find Favorites Error:', error);
      return Err('Lỗi truy vấn bài hát yêu thích.');
    }
  }

  async isFavorited(userId: string, songId: string): Promise<Result<boolean, string>> {
    try {
      const record = await this.prismaService.favorite.findUnique({
        where: { userId_songId: { userId, songId } },
        select: { id: true },
      });

      return Ok(record !== null);
    } catch (error) {
      console.error('Is Favorited Error:', error);
      return Err('Lỗi truy vấn bài hát yêu thích.');
    }
  }
}
