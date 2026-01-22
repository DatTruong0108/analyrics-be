// /* System Package */
import { Controller, Get, Query, Res, Body, HttpStatus, Post } from "@nestjs/common";
import { Response } from "express";
import { ApiQuery, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Result, match } from "oxide.ts";

// /* Application Package */
import { AnalysisService } from "./services/analysis.service";
import { ISongMetadata } from "./interfaces/analysis.interface";
import { IPaginatedResult } from "src/shared/constants/paginatedResult";
import { AnalysisWithSong } from "./repositories/analysis.repository.impl";
import { SongMetadataDto } from "./analysis.dto";

@ApiTags('Analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) { }

  @Get('search')
  @ApiOperation({ summary: 'Tìm kiếm bài hát từ Spotify (Phân trang)' })
  @ApiQuery({ name: 'q', description: 'Từ khóa tìm kiếm' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  async search(
    @Query('q') q: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IPaginatedResult<ISongMetadata>, string> =
      await this.analysisService.searchSongs(q, +page, +limit);

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

  @Post('analyze')
  @ApiOperation({ summary: 'Phân tích chi tiết lời bài hát bằng AI' })
  async analyze(
    @Body() songMetadata: SongMetadataDto,
    @Res() res: Response
  ): Promise<void> {
    const result: Result<AnalysisWithSong, string> = await this.analysisService.getOrGenerateAnalysis(songMetadata);

    return match(result, {
      Ok: (data: AnalysisWithSong) => {
        res.status(HttpStatus.OK).json({
          statusCode: HttpStatus.OK,
          message: 'Phân tích bài hát thành công',
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
}