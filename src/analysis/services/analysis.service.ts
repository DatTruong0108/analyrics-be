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

@Injectable()
export class AnalysisService {
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

  async getOrGenerateAnalysis(songDto: ISongMetadata): Promise<Result<AnalysisWithSong, string>> {
    try {
      // 1. Kiểm tra Database xem bài hát đã từng được phân tích chưa
      const existingRes = await this.repository.findAnalysisBySongId(songDto.id);
      if (existingRes.isErr()) return Err(existingRes.unwrapErr());

      const cachedData = existingRes.unwrap();
      if (cachedData) return Ok(cachedData); // Trả về kết quả từ DB nếu có

      // 2. Nếu chưa có, lấy lời bài hát từ Genius
      const lyricsRes = await this.lyricsService.getLyrics(songDto.title, songDto.artist);
      if (lyricsRes.isErr()) return Err(lyricsRes.unwrapErr());
      const fullLyrics = lyricsRes.unwrap();

      // 3. Gửi lời bài hát sang AI để phân tích đa thể loại (Rap, Pop, Cải lương...)
      const aiRes = await this.aiService.analyzeLyrics(
        songDto.title,
        songDto.artist,
        fullLyrics
      );
      if (aiRes.isErr()) return Err(aiRes.unwrapErr());
      const analysisData = aiRes.unwrap();

      // 4. Lưu cả thông tin bài hát và bản phân tích vào Database (Transaction)
      const saveRes = await this.repository.saveAnalysis(songDto, analysisData);
      if (saveRes.isErr()) return Err(saveRes.unwrapErr());

      // 5. Trả về kết quả hoàn chỉnh
      return Ok({
        ...analysisData,
        song: songDto,
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