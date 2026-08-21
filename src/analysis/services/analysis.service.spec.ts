/* System Package */
import { Test, TestingModule } from '@nestjs/testing';
import { Result, Ok, Err } from 'oxide.ts';

/* Application Package */
import { AnalysisService } from './analysis.service';
import { SpotifyService } from './spotify.service';
import { SearchService } from './search.service';
import { LyricsService, ILyrics } from './lyrics.service';
import { AIService } from './ai.service';
import { IAnalysisRepository } from '../repositories/analysis.repository';
import { AnalysisWithSong } from '../repositories/analysis.repository.impl';
import { IAnalysisResult } from '../interfaces/analysis.interface';
import { AnalyzeSongDto } from '../analysis.dto';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending microtask settle so in-flight calls reach their next await. */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function buildSongDto(id: string): AnalyzeSongDto {
  return {
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    imageUrl: 'https://example.test/cover.jpg',
    spotifyUrl: 'https://example.test/track',
    previewUrl: 'https://example.test/preview.mp3',
  };
}

function buildAnalysisResult(id: string): IAnalysisResult {
  return {
    fullLyrics: `lyrics ${id}`,
    syncedLyrics: null,
    vibe: 'calm',
    overview: `overview ${id}`,
    analysis: [],
    metaphors: [],
    coreMessage: `message ${id}`,
  };
}

const LYRICS: ILyrics = { plain: 'plain lyrics', synced: '[00:01.00] plain lyrics' };
const ANALYSIS_ID = 'analysis-row-1';
const GENERATION_TIMEOUT_MS = 90_000;

describe('AnalysisService.getOrGenerateAnalysis (in-flight deduplication)', () => {
  let service: AnalysisService;
  let lyricsService: { getLyrics: jest.Mock };
  let aiService: { analyzeLyrics: jest.Mock };
  let searchService: { search: jest.Mock; getPreviewUrl: jest.Mock };
  let repository: {
    findAnalysisBySongId: jest.Mock;
    saveAnalysis: jest.Mock;
    findTrendings: jest.Mock;
    findUserHistory: jest.Mock;
    recordUserHistory: jest.Mock;
  };

  beforeEach(async () => {
    lyricsService = { getLyrics: jest.fn() };
    aiService = { analyzeLyrics: jest.fn() };
    searchService = { search: jest.fn(), getPreviewUrl: jest.fn() };
    repository = {
      // No cached analysis: every call under test takes the generation path.
      findAnalysisBySongId: jest.fn().mockResolvedValue(Ok(null)),
      saveAnalysis: jest.fn().mockResolvedValue(Ok(ANALYSIS_ID)),
      findTrendings: jest.fn(),
      findUserHistory: jest.fn(),
      recordUserHistory: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: SpotifyService, useValue: {} },
        { provide: SearchService, useValue: searchService },
        { provide: LyricsService, useValue: lyricsService },
        { provide: AIService, useValue: aiService },
        { provide: IAnalysisRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get<AnalysisService>(AnalysisService);
  });

  it('calls the lyrics and AI dependencies exactly once for concurrent requests on the same songId', async () => {
    const lyricsDeferred = createDeferred<Result<ILyrics, string>>();
    lyricsService.getLyrics.mockReturnValue(lyricsDeferred.promise);
    aiService.analyzeLyrics.mockResolvedValue(Ok(buildAnalysisResult('song-1')));

    // Three requests for the same song: two logged-in users and one anonymous.
    const first = service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
    const second = service.getOrGenerateAnalysis('user-b', buildSongDto('song-1'));
    const third = service.getOrGenerateAnalysis(null, buildSongDto('song-1'));

    await flushMicrotasks();
    expect(lyricsService.getLyrics).toHaveBeenCalledTimes(1);

    lyricsDeferred.resolve(Ok(LYRICS));
    const results = await Promise.all([first, second, third]);

    expect(lyricsService.getLyrics).toHaveBeenCalledTimes(1);
    expect(aiService.analyzeLyrics).toHaveBeenCalledTimes(1);
    expect(repository.saveAnalysis).toHaveBeenCalledTimes(1);

    for (const result of results) {
      expect(result.isOk()).toBe(true);
    }
    // Joiners share the payload of the request that started the generation
    // rather than generating their own.
    const [firstData, secondData, thirdData] = results.map((result) => result.unwrap());
    expect(secondData).toBe(firstData);
    expect(thirdData).toBe(firstData);
    expect(firstData.fromCache).toBe(false);
  });

  it('records history for every logged-in joiner, not just the request that started the generation', async () => {
    const lyricsDeferred = createDeferred<Result<ILyrics, string>>();
    lyricsService.getLyrics.mockReturnValue(lyricsDeferred.promise);
    aiService.analyzeLyrics.mockResolvedValue(Ok(buildAnalysisResult('song-1')));

    const leader = service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
    const joiner = service.getOrGenerateAnalysis('user-b', buildSongDto('song-1'));
    const anonymousJoiner = service.getOrGenerateAnalysis(null, buildSongDto('song-1'));

    await flushMicrotasks();
    lyricsDeferred.resolve(Ok(LYRICS));
    await Promise.all([leader, joiner, anonymousJoiner]);

    // The starter row is written inside the saveAnalysis transaction...
    expect(repository.saveAnalysis).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ id: 'song-1' }),
      expect.objectContaining({ vibe: 'calm' }),
    );
    // ...and the joiner gets its own row afterwards, keyed by the saved id.
    // The anonymous request records nothing.
    expect(repository.recordUserHistory).toHaveBeenCalledTimes(1);
    expect(repository.recordUserHistory).toHaveBeenCalledWith('user-b', ANALYSIS_ID);
  });

  it('runs generations for different songIds in parallel', async () => {
    const deferredBySong = new Map<string, Deferred<Result<ILyrics, string>>>([
      ['song-1', createDeferred<Result<ILyrics, string>>()],
      ['song-2', createDeferred<Result<ILyrics, string>>()],
    ]);
    lyricsService.getLyrics.mockImplementation((title: string) =>
      title.endsWith('song-1')
        ? deferredBySong.get('song-1')!.promise
        : deferredBySong.get('song-2')!.promise,
    );
    aiService.analyzeLyrics.mockImplementation((title: string) =>
      Promise.resolve(Ok(buildAnalysisResult(title))),
    );

    const first = service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
    const second = service.getOrGenerateAnalysis('user-b', buildSongDto('song-2'));

    // Neither generation has finished, yet both already reached the lyrics call:
    // one song is not blocking the other.
    await flushMicrotasks();
    expect(lyricsService.getLyrics).toHaveBeenCalledTimes(2);

    deferredBySong.get('song-1')!.resolve(Ok(LYRICS));
    deferredBySong.get('song-2')!.resolve(Ok(LYRICS));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.isOk()).toBe(true);
    expect(secondResult.isOk()).toBe(true);
    expect(aiService.analyzeLyrics).toHaveBeenCalledTimes(2);
    expect(repository.saveAnalysis).toHaveBeenCalledTimes(2);
    expect(firstResult.unwrap().song.id).toBe('song-1');
    expect(secondResult.unwrap().song.id).toBe('song-2');
  });

  it('drops the in-flight entry once a generation succeeds, so a later request generates again', async () => {
    lyricsService.getLyrics.mockResolvedValue(Ok(LYRICS));
    aiService.analyzeLyrics.mockResolvedValue(Ok(buildAnalysisResult('song-1')));

    const firstResult = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
    expect(firstResult.isOk()).toBe(true);

    const secondResult = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
    expect(secondResult.isOk()).toBe(true);

    expect(lyricsService.getLyrics).toHaveBeenCalledTimes(2);
    expect(aiService.analyzeLyrics).toHaveBeenCalledTimes(2);
  });

  it('propagates a generation failure to every joiner and drops the in-flight entry', async () => {
    lyricsService.getLyrics
      .mockRejectedValueOnce(new Error('LrcLib unreachable'))
      .mockResolvedValueOnce(Ok(LYRICS));
    aiService.analyzeLyrics.mockResolvedValue(Ok(buildAnalysisResult('song-1')));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const first = service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
      const second = service.getOrGenerateAnalysis('user-b', buildSongDto('song-1'));
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.isErr()).toBe(true);
      expect(secondResult.isErr()).toBe(true);
      expect(secondResult.unwrapErr()).toBe(firstResult.unwrapErr());
      expect(lyricsService.getLyrics).toHaveBeenCalledTimes(1);
      expect(repository.saveAnalysis).not.toHaveBeenCalled();
      // A failed generation must not leave a history row behind.
      expect(repository.recordUserHistory).not.toHaveBeenCalled();

      // The failed entry was cleaned up, so the next request retries instead of
      // being stuck on a dead promise.
      const retry = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
      expect(retry.isOk()).toBe(true);
      expect(lyricsService.getLyrics).toHaveBeenCalledTimes(2);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('gives up a generation that outlives the timeout and frees the songId for the next request', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // A stalled upstream call: this promise never settles.
      lyricsService.getLyrics
        .mockReturnValueOnce(new Promise<Result<ILyrics, string>>(() => undefined))
        .mockResolvedValueOnce(Ok(LYRICS));
      aiService.analyzeLyrics.mockResolvedValue(Ok(buildAnalysisResult('song-1')));

      const stalled = service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
      await flushMicrotasks();
      expect(lyricsService.getLyrics).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS);
      const stalledResult = await stalled;

      expect(stalledResult.isErr()).toBe(true);
      // Contains the marker the controller maps to HTTP 500.
      expect(stalledResult.unwrapErr()).toContain('Hệ thống');

      // The abandoned generation no longer owns the songId.
      const retry = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));
      expect(retry.isOk()).toBe(true);
      expect(lyricsService.getLyrics).toHaveBeenCalledTimes(2);
    } finally {
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('serves a cached analysis without entering the generation path', async () => {
    const cached: AnalysisWithSong = {
      ...buildAnalysisResult('song-1'),
      song: buildSongDto('song-1'),
    };
    repository.findAnalysisBySongId.mockResolvedValue(Ok(cached));

    const result = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().fromCache).toBe(true);
    expect(lyricsService.getLyrics).not.toHaveBeenCalled();
    expect(aiService.analyzeLyrics).not.toHaveBeenCalled();
  });

  it('returns the repository error without generating when the cache lookup fails', async () => {
    repository.findAnalysisBySongId.mockResolvedValue(Err('Lỗi truy vấn cơ sở dữ liệu.'));

    const result = await service.getOrGenerateAnalysis('user-a', buildSongDto('song-1'));

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('Lỗi truy vấn cơ sở dữ liệu.');
    expect(lyricsService.getLyrics).not.toHaveBeenCalled();
  });
});
