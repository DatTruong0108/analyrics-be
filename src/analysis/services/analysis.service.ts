/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";

/* Application Package */
import { IAnalysisRepository } from "../repositories/analysis.repository";
import { SpotifyService } from "./spotify.service";
import { SearchService } from "./search.service";
import { LyricsService } from "./lyrics.service";
import { AIService } from "./ai.service";
import { ISongMetadata } from "../interfaces/analysis.interface";
import { IPaginatedResult } from "src/shared/constants/paginatedResult";
import { AnalysisWithSong } from "../repositories/analysis.repository.impl";
import { AnalyzeSongDto } from "../analysis.dto";

type GeneratedAnalysis = AnalysisWithSong & { fromCache: boolean };

/**
 * What a generation hands back internally: the response payload plus the id of
 * the saved row, which joining requests need to record their own history.
 */
type GenerationOutcome = {
  payload: GeneratedAnalysis;
  analysisId: string;
};

@Injectable()
export class AnalysisService {
  /**
   * A generation runs a LrcLib lookup plus Gemini retry loops, and the Gemini
   * SDK is called without any timeout of its own. Cap the whole thing so one
   * stalled call cannot keep owning its songId forever.
   */
  private readonly GENERATION_TIMEOUT_MS = 90_000;

  /**
   * Generations currently running, keyed by songId. A cache miss costs a LrcLib
   * lookup plus a Gemini call, so concurrent requests for the same song share
   * one promise instead of each paying for its own.
   *
   * TODO(single-instance): this map lives in one process's heap, so it only
   * dedupes within a single instance. Running more than one replica needs a
   * distributed lock (e.g. Redis SETNX on the songId) to dedupe across them.
   */
  private readonly inFlightGenerations = new Map<string, Promise<Result<GenerationOutcome, string>>>();

  constructor(
    private readonly spotifyService: SpotifyService,
    private readonly searchService: SearchService,
    private readonly lyricsService: LyricsService,
    private readonly aiService: AIService,
    private readonly repository: IAnalysisRepository,
  ) { }

  async searchSongs(query: string, page: number, limit: number): Promise<Result<IPaginatedResult<ISongMetadata>, string>> {
    return await this.searchService.search(query, page, limit);
  }

  async getOrGenerateAnalysis(userId: string | null, songDto: AnalyzeSongDto): Promise<Result<GeneratedAnalysis, string>> {
    try {
      // 1. Chỉ kiểm tra Cache nếu người dùng KHÔNG yêu cầu forceRefresh
      if (!songDto.forceRefresh) {
        const existingRes = await this.repository.findAnalysisBySongId(songDto.id);
        if (existingRes.isErr()) return Err(existingRes.unwrapErr());

        const cachedData = existingRes.unwrap();
        if (cachedData) {
          if (userId) {
            const analysisId = (cachedData as any).id;
            await this.repository.recordUserHistory(userId, analysisId);
          }
          // Trả về kèm flag fromCache: true
          return Ok({ ...cachedData, fromCache: true });
        }
      }

      // Cache miss: join the generation already running for this song, if any.
      // A forceRefresh request may join too — whatever is in flight is being
      // generated right now, which is exactly what forceRefresh asks for.
      const inFlight = this.inFlightGenerations.get(songDto.id);
      if (inFlight) return await this.settleGeneration(userId, inFlight);

      const generation = this.runWithTimeout(this.generateAnalysis(userId, songDto))
        .finally(() => this.inFlightGenerations.delete(songDto.id));
      this.inFlightGenerations.set(songDto.id, generation);

      // null: this request started the generation, so saveAnalysis already wrote
      // its UserHistory row inside the transaction.
      return await this.settleGeneration(null, generation);
    } catch (error: unknown) {
      console.error('AnalysisService Error:', error);
      return Err('Quá trình phân tích gặp sự cố. Hệ thống bị lỗi vui lòng thử lại sau.');
    }
  }

  /**
   * Unwraps a generation into the public payload. joiningUserId is set only for
   * requests that joined a generation someone else started: the request that
   * started it already got its UserHistory row from saveAnalysis.
   */
  private async settleGeneration(joiningUserId: string | null, generation: Promise<Result<GenerationOutcome, string>>): Promise<Result<GeneratedAnalysis, string>> {
    const outcome = await generation;
    if (outcome.isErr()) return Err(outcome.unwrapErr());

    const { payload, analysisId } = outcome.unwrap();
    if (joiningUserId) {
      await this.repository.recordUserHistory(joiningUserId, analysisId);
    }

    return Ok(payload);
  }

  /**
   * Resolves to Err once a generation outlives GENERATION_TIMEOUT_MS. The
   * generation itself is abandoned rather than cancelled, but it stops owning
   * the songId, so the next request starts fresh work instead of waiting on a
   * promise that may never settle.
   */
  private async runWithTimeout(generation: Promise<Result<GenerationOutcome, string>>): Promise<Result<GenerationOutcome, string>> {
    let timer: NodeJS.Timeout | undefined;
    // An abandoned generation still settles eventually; keep it from surfacing
    // as an unhandled rejection.
    void generation.catch((error: unknown) => console.error('Abandoned analysis generation failed:', error));

    const timeout = new Promise<Result<GenerationOutcome, string>>((resolve) => {
      timer = setTimeout(
        () => resolve(Err('Quá trình phân tích quá lâu. Hệ thống tạm thời không phản hồi, vui lòng thử lại sau.')),
        this.GENERATION_TIMEOUT_MS,
      );
    });

    try {
      return await Promise.race([generation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Builds a brand new analysis: lyrics -> AI -> persist. Only ever called
   * through the inFlightGenerations map, never directly.
   */
  private async generateAnalysis(userId: string | null, songDto: AnalyzeSongDto): Promise<Result<GenerationOutcome, string>> {
    try {
      // 2. Nếu chưa có, lấy lời bài hát từ LrcLib
      const lyricsRes = await this.lyricsService.getLyrics(songDto.title, songDto.artist);
      if (lyricsRes.isErr()) return Err(lyricsRes.unwrapErr());
      const { plain, synced } = lyricsRes.unwrap();

      // 3. Gửi lời bài hát sang AI để phân tích đa thể loại (Rap, Pop, Cải lương...)
      const aiRes = await this.aiService.analyzeLyrics(
        songDto.title,
        songDto.artist,
        plain
      );
      if (aiRes.isErr()) return Err(aiRes.unwrapErr());
      const analysisData = aiRes.unwrap();
      analysisData.syncedLyrics = synced;

      if (!songDto.previewUrl) {
        const previewUrlRes = await this.searchService.getPreviewUrl(songDto.title, songDto.artist);
        if (previewUrlRes.isErr()) {
          console.error('Error getting preview URL:', previewUrlRes.unwrapErr());
          songDto.previewUrl = null;
        } else {
          songDto.previewUrl = previewUrlRes.unwrap();
        }
      }

      // 4. Lưu cả thông tin bài hát và bản phân tích vào Database (Transaction)
      const saveRes = await this.repository.saveAnalysis(userId, songDto, analysisData);
      if (saveRes.isErr()) return Err(saveRes.unwrapErr());

      // 5. Trả về kết quả hoàn chỉnh
      return Ok({
        payload: {
          ...analysisData,
          song: songDto,
          fromCache: false
        },
        analysisId: saveRes.unwrap()
      });

    } catch (error: unknown) {
      console.error('AnalysisService Error:', error);
      return Err('Quá trình phân tích gặp sự cố. Hệ thống bị lỗi vui lòng thử lại sau.');
    }
  }

  async getTrending(limit: number = 10, offset: number = 0): Promise<Result<{ items: ISongMetadata[]; hasMore: boolean }, string>> {
    const result = await this.repository.findTrendings(limit, offset);

    if (result.isErr()) return Err(result.unwrapErr());

    const { items, total } = result.unwrap();

    const hasMore = offset + limit < total;

    return Ok({ items, hasMore });
  }
}