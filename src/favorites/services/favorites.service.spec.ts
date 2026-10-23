/* System Package */
import { Ok, Err } from 'oxide.ts';

/* Application Package */
import { FavoritesService } from './favorites.service';
import { IFavoritesRepository } from '../repositories/favorites.repository';
import { IFavoriteItem } from '../interfaces/favorite.interface';

const item = (id: string): IFavoriteItem => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  imageUrl: 'https://example.com/a.jpg',
  spotifyUrl: 'https://open.spotify.com/track/a',
  previewUrl: null,
  favoritedAt: new Date('2026-10-22T08:00:00.000Z'),
});

function buildService(repository: Partial<IFavoritesRepository>): FavoritesService {
  return new FavoritesService(repository as IFavoritesRepository);
}

describe('FavoritesService.addFavorite', () => {
  it('scopes the add to the caller and reports success', async () => {
    const addFavorite = jest.fn().mockResolvedValue(Ok(true));
    const service = buildService({ addFavorite });

    const result = await service.addFavorite('user-1', 'song-1');

    expect(addFavorite).toHaveBeenCalledWith('user-1', 'song-1');
    expect(result.unwrap()).toBe(true);
  });

  it('reports a song that does not exist as not added', async () => {
    const service = buildService({ addFavorite: jest.fn().mockResolvedValue(Ok(false)) });

    const result = await service.addFavorite('user-1', 'unknown-song');

    expect(result.unwrap()).toBe(false);
  });

  it('passes a repository failure through unchanged', async () => {
    const service = buildService({ addFavorite: jest.fn().mockResolvedValue(Err('Lỗi khi thêm bài hát yêu thích.')) });

    const result = await service.addFavorite('user-1', 'song-1');

    expect(result.unwrapErr()).toBe('Lỗi khi thêm bài hát yêu thích.');
  });
});

describe('FavoritesService.removeFavorite', () => {
  it('scopes the delete to the caller', async () => {
    const removeFavorite = jest.fn().mockResolvedValue(Ok(undefined));
    const service = buildService({ removeFavorite });

    const result = await service.removeFavorite('user-1', 'song-1');

    expect(removeFavorite).toHaveBeenCalledWith('user-1', 'song-1');
    expect(result.isOk()).toBe(true);
  });

  it('passes a repository failure through unchanged', async () => {
    const service = buildService({ removeFavorite: jest.fn().mockResolvedValue(Err('Lỗi khi xoá bài hát yêu thích.')) });

    const result = await service.removeFavorite('user-1', 'song-1');

    expect(result.unwrapErr()).toBe('Lỗi khi xoá bài hát yêu thích.');
  });
});

describe('FavoritesService.getFavorites', () => {
  it('reports more pages while rows remain past this page', async () => {
    const findFavorites = jest.fn().mockResolvedValue(Ok({ items: [item('1'), item('2')], total: 5 }));
    const service = buildService({ findFavorites });

    const result = await service.getFavorites('user-1', 2, 0);

    expect(findFavorites).toHaveBeenCalledWith('user-1', 2, 0);
    expect(result.unwrap()).toEqual({ items: [item('1'), item('2')], total: 5, hasMore: true });
  });

  it('reports no more pages when this page ends exactly at the total', async () => {
    const service = buildService({ findFavorites: jest.fn().mockResolvedValue(Ok({ items: [item('5'), item('6')], total: 6 })) });

    const result = await service.getFavorites('user-1', 2, 4);

    expect(result.unwrap().hasMore).toBe(false);
  });

  it('passes a repository failure through unchanged', async () => {
    const service = buildService({ findFavorites: jest.fn().mockResolvedValue(Err('Lỗi truy vấn bài hát yêu thích.')) });

    const result = await service.getFavorites('user-1', 10, 0);

    expect(result.unwrapErr()).toBe('Lỗi truy vấn bài hát yêu thích.');
  });
});

describe('FavoritesService.isFavorited', () => {
  it('answers false for a guest without querying', async () => {
    const isFavorited = jest.fn();
    const service = buildService({ isFavorited });

    await expect(service.isFavorited(null, 'song-1')).resolves.toBe(false);
    expect(isFavorited).not.toHaveBeenCalled();
  });

  it('answers what the repository found for a signed-in caller', async () => {
    const isFavorited = jest.fn().mockResolvedValue(Ok(true));
    const service = buildService({ isFavorited });

    await expect(service.isFavorited('user-1', 'song-1')).resolves.toBe(true);
    expect(isFavorited).toHaveBeenCalledWith('user-1', 'song-1');
  });

  it('degrades a lookup failure to false instead of failing the analysis', async () => {
    const service = buildService({ isFavorited: jest.fn().mockResolvedValue(Err('db down')) });

    await expect(service.isFavorited('user-1', 'song-1')).resolves.toBe(false);
  });
});

describe('FavoritesService.getFavoriteState', () => {
  it('answers what the repository found, scoped to the caller', async () => {
    const isFavorited = jest.fn().mockResolvedValue(Ok(true));
    const service = buildService({ isFavorited });

    const result = await service.getFavoriteState('user-1', 'song-1');

    expect(isFavorited).toHaveBeenCalledWith('user-1', 'song-1');
    expect(result.unwrap()).toBe(true);
  });

  it('reports a lookup failure instead of guessing false', async () => {
    const service = buildService({ isFavorited: jest.fn().mockResolvedValue(Err('Lỗi truy vấn bài hát yêu thích.')) });

    const result = await service.getFavoriteState('user-1', 'song-1');

    expect(result.unwrapErr()).toBe('Lỗi truy vấn bài hát yêu thích.');
  });
});
