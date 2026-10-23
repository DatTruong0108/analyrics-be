/* System Package */
import { Ok, Err } from 'oxide.ts';

/* Application Package */
import { AnalysisService } from './analysis.service';
import { SpotifyService } from './spotify.service';
import { SearchService } from './search.service';
import { LyricsService } from './lyrics.service';
import { AIService } from './ai.service';
import { IAnalysisRepository } from '../repositories/analysis.repository';
import { IHistoryItem } from '../interfaces/analysis.interface';

const item = (id: string): IHistoryItem => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  imageUrl: 'https://example.com/a.jpg',
  spotifyUrl: 'https://open.spotify.com/track/a',
  previewUrl: null,
  viewedAt: new Date('2026-10-22T08:00:00.000Z'),
});

/** Only the history query is exercised; every other dependency stays unused. */
function buildService(findUserHistory: jest.Mock): AnalysisService {
  const repository = { findUserHistory } as Partial<IAnalysisRepository> as IAnalysisRepository;

  return new AnalysisService(
    {} as SpotifyService,
    {} as SearchService,
    {} as LyricsService,
    {} as AIService,
    repository,
  );
}

describe('AnalysisService.getUserHistory', () => {
  it('reports more pages while rows remain past this page', async () => {
    const findUserHistory = jest.fn().mockResolvedValue(Ok({ items: [item('1'), item('2')], total: 5 }));
    const service = buildService(findUserHistory);

    const result = await service.getUserHistory('user-1', 2, 0);

    expect(findUserHistory).toHaveBeenCalledWith('user-1', 2, 0);
    expect(result.unwrap()).toEqual({ items: [item('1'), item('2')], total: 5, hasMore: true });
  });

  it('reports no more pages when this page ends exactly at the total', async () => {
    const findUserHistory = jest.fn().mockResolvedValue(Ok({ items: [item('5'), item('6')], total: 6 }));
    const service = buildService(findUserHistory);

    const result = await service.getUserHistory('user-1', 2, 4);

    expect(result.unwrap().hasMore).toBe(false);
  });

  it('reports no more pages for an empty history', async () => {
    const findUserHistory = jest.fn().mockResolvedValue(Ok({ items: [], total: 0 }));
    const service = buildService(findUserHistory);

    const result = await service.getUserHistory('user-1', 10, 0);

    expect(result.unwrap()).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('passes a repository failure through unchanged', async () => {
    const findUserHistory = jest.fn().mockResolvedValue(Err('Lỗi truy vấn lịch sử.'));
    const service = buildService(findUserHistory);

    const result = await service.getUserHistory('user-1', 10, 0);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('Lỗi truy vấn lịch sử.');
  });
});

describe('AnalysisService.removeFromHistory', () => {
  function buildRemoveService(deleteUserHistory: jest.Mock): AnalysisService {
    const repository = { deleteUserHistory } as Partial<IAnalysisRepository> as IAnalysisRepository;

    return new AnalysisService(
      {} as SpotifyService,
      {} as SearchService,
      {} as LyricsService,
      {} as AIService,
      repository,
    );
  }

  it('scopes the delete to the caller and reports the song as removed', async () => {
    const deleteUserHistory = jest.fn().mockResolvedValue(Ok(1));
    const service = buildRemoveService(deleteUserHistory);

    const result = await service.removeFromHistory('user-1', 'song-1');

    expect(deleteUserHistory).toHaveBeenCalledWith('user-1', 'song-1');
    expect(result.unwrap()).toBe(true);
  });

  it('reports not removed when the song is not in the caller\'s history', async () => {
    const deleteUserHistory = jest.fn().mockResolvedValue(Ok(0));
    const service = buildRemoveService(deleteUserHistory);

    const result = await service.removeFromHistory('user-1', 'someone-elses-song');

    expect(result.unwrap()).toBe(false);
  });

  it('passes a repository failure through unchanged', async () => {
    const deleteUserHistory = jest.fn().mockResolvedValue(Err('Lỗi khi xoá lịch sử.'));
    const service = buildRemoveService(deleteUserHistory);

    const result = await service.removeFromHistory('user-1', 'song-1');

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('Lỗi khi xoá lịch sử.');
  });
});
