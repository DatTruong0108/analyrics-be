// /* System Package */
import { Controller, Get, Query, Res, Body, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { ApiOperation, ApiTags, ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Result, match } from "oxide.ts";

// /* Application Package */
import { AnalysisService } from "./services/analysis.service";
import { ISongMetadata } from "./interfaces/analysis.interface";
import { IPaginatedResult } from "src/shared/constants/paginatedResult";
import { AnalysisWithSong } from "./repositories/analysis.repository.impl";
import { AnalyzeSongDto, SearchSongsQueryDto, TrendingQueryDto } from "./analysis.dto";
import { AtGuard } from "src/auth/guards/at.guard";
import { GetCurrentUserId } from "src/shared/decorators/getCurrentUserId.decorator";
import {
  ANALYZE_THROTTLE_LIMIT,
  ANALYZE_THROTTLE_TTL,
  THROTTLE_ERROR_MESSAGE,
} from "src/shared/constants/throttle";

@ApiTags('Analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) { }

  @Get('search')
  @ApiOperation({ summary: 'Tìm kiếm bài hát từ Spotify (Phân trang)' })
  async search(
    @Query() query: SearchSongsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IPaginatedResult<ISongMetadata>, string> =
      await this.analysisService.searchSongs(query.q, query.page, query.limit);

    return match(result, {
      Ok: (paginatedData: IPaginatedResult<ISongMetadata>) => {
        res.status(HttpStatus.OK).json({
          statusCode: HttpStatus.OK,
          message: 'Tìm kiếm thành công',
          data: paginatedData,
        });
      },
      Err: (err: string) => {
        res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: err,
        });
      },
    });
  }

  // Far stricter than the app-wide default: a cache miss here calls Gemini and
  // LrcLib/Deezer, so every request past the cache costs money and quota.
  @Throttle({
    default: { limit: ANALYZE_THROTTLE_LIMIT, ttl: ANALYZE_THROTTLE_TTL },
  })
  @UseGuards(AtGuard)
  @Post('analyze')
  @ApiOperation({ summary: 'Phân tích chi tiết lời bài hát bằng AI' })
  @ApiTooManyRequestsResponse({ description: THROTTLE_ERROR_MESSAGE })
  async analyze(
    @GetCurrentUserId() userId: string | null,
    @Body() songMetadata: AnalyzeSongDto,
    @Res() res: Response
  ): Promise<void> {
    const result: Result<AnalysisWithSong & { fromCache: boolean }, string> = await this.analysisService.getOrGenerateAnalysis(userId, songMetadata);

    return match(result, {
      Ok: (data: AnalysisWithSong & { fromCache: boolean }) => {
        res.status(HttpStatus.OK).json({
          statusCode: HttpStatus.OK,
          message: data.fromCache
            ? 'Sử dụng bản phân tích từ bộ nhớ tạm'
            : 'Phân tích bài hát mới thành công',
          data: data,
        });
      },
      Err: (err: string) => {
        const isSystem = err.includes('Hệ thống');
        const status = isSystem ? HttpStatus.INTERNAL_SERVER_ERROR : HttpStatus.BAD_REQUEST;

        res.status(status).json({
          statusCode: status,
          message: err,
        });
      },
    });
  }

  @Get('trending')
  @ApiOperation({ summary: 'Lấy danh sách các bài hát được phân tích nhiều (Trending)' })
  async getTrending(
    @Query() query: TrendingQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.analysisService.getTrending(query.limit, query.offset);

    return match(result, {
      Ok: (data) => {
        res.status(HttpStatus.OK).json({
          statusCode: HttpStatus.OK,
          message: 'Lấy danh sách trending thành công',
          data: data.items,
          hasMore: data.hasMore,
        });
      },
      Err: (err) => {
        res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: err,
        });
      },
    });
  }
}