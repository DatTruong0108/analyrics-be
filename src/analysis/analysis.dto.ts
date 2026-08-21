import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, IsOptional, IsBoolean, IsInt, Min, Max, MaxLength } from 'class-validator';
import { BaseResponse } from 'src/shared/constants/baseResponse';
import {
  DEFAULT_OFFSET,
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_OFFSET,
  MAX_PAGE_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  MIN_OFFSET,
  MIN_PAGE,
  MIN_PAGE_LIMIT,
} from 'src/shared/constants/pagination';

/**
 * Builds the parser for a numeric query param.
 *
 * It does the conversion `@Type(() => Number)` would, because `@Type` runs
 * first and turns `?page=` into 0, which then fails @Min — so a client that
 * sent an empty value would get a 400 instead of the default. Returning the
 * fallback here covers that case; the field initializer covers a param the
 * client omitted entirely, since @Transform does not run for an absent key.
 * A non-numeric value becomes NaN and @IsInt rejects it.
 */
function numberOrDefault(fallback: number) {
  return ({ value }: { value: string | undefined }): number =>
    value === undefined || value === '' ? fallback : Number(value);
}

/** Trims so `q=%20%20abc` and `q=abc` are not two different searches. */
function trimText({ value }: { value: string | undefined }): string | undefined {
  return typeof value === 'string' ? value.trim() : value;
}

export class SongMetadataDto {
  @ApiProperty({ example: '2up3OPMp9Tb4dAKM2erWXQ', description: 'Spotify Track ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 'Nước Mắt Cá Sấu', description: 'Tên bài hát' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'HIEUTHUHAI', description: 'Tên nghệ sĩ/nhóm nhạc' })
  @IsString()
  @IsNotEmpty()
  artist: string;

  @ApiProperty({ example: 'Album 1', description: 'Tên Album' })
  @IsString()
  @IsNotEmpty()
  album: string;

  @ApiProperty({ example: 'https://i.scdn.co/image/...', description: 'Link ảnh bìa bài hát' })
  @IsString()
  @IsUrl()
  imageUrl: string;

  @ApiProperty({ example: 'https://open.spotify.com/track/...', description: 'Link nghe nhạc trên Spotify' })
  @IsString()
  @IsUrl()
  spotifyUrl: string;

  @ApiProperty({ example: 'https://...', description: 'Link nghe trước' })
  @IsString()
  @IsOptional()
  @IsUrl()
  previewUrl: string | null;
}

export class AnalysisSectionDto {
  @ApiProperty({ example: 'Verse 1' })
  section: string;

  @ApiProperty({ example: 'Nước mắt cá sấu chẳng thể cứu lấy...' })
  lyricsQuote: string;

  @ApiProperty({ example: 'Đoạn này sử dụng ẩn dụ về sự giả dối trong tình yêu...' })
  content: string;
}

export class MetaphorDto {
  @ApiProperty({ example: 'Nước mắt cá sấu' })
  phrase: string;

  @ApiProperty({ example: 'Thành ngữ chỉ sự hối lỗi giả tạo, không chân thành.' })
  meaning: string;
}

export class DetailedAnalysisDto {
  @ApiProperty({ example: 'Lời bài hát đầy đủ...' })
  fullLyrics: string;

  @ApiProperty({ example: 'Lời bài hát đã được đồng bộ...' })
  syncedLyrics: string;

  @ApiProperty({ example: 'Châm biếm, dứt khoát' })
  vibe: string;

  @ApiProperty({ example: 'Bài hát nói về sự phản bội và thái độ cứng rắn của chàng trai...' })
  overview: string;

  @ApiProperty({ type: [AnalysisSectionDto] })
  analysis: AnalysisSectionDto[];

  @ApiProperty({ type: [MetaphorDto] })
  metaphors: MetaphorDto[];

  @ApiProperty({ example: 'Đừng để những giọt nước mắt giả tạo đánh lừa bản thân.' })
  coreMessage: string;
}

export class AnalyzeSongDto extends SongMetadataDto {
  @ApiProperty({ example: false, description: 'Ép buộc AI tạo bản phân tích mới', required: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}

/**
 * Query params for GET /analysis/search.
 *
 * The global ValidationPipe runs with `transform: true` but not
 * `enableImplicitConversion`, so numeric params arrive as strings and need the
 * explicit `numberOrDefault` transform above to become numbers.
 */
export class SearchSongsQueryDto {
  @ApiProperty({
    example: 'Nước Mắt Cá Sấu',
    description: 'Từ khóa tìm kiếm',
    maxLength: MAX_SEARCH_QUERY_LENGTH,
  })
  @Transform(trimText)
  @IsString()
  /* Sau khi trim, IsNotEmpty cũng chặn luôn chuỗi chỉ gồm khoảng trắng ("q=%20"). */
  @IsNotEmpty()
  @MaxLength(MAX_SEARCH_QUERY_LENGTH)
  q: string;

  @ApiPropertyOptional({ example: DEFAULT_PAGE, minimum: MIN_PAGE, default: DEFAULT_PAGE })
  @IsOptional()
  @Transform(numberOrDefault(DEFAULT_PAGE))
  @IsInt()
  @Min(MIN_PAGE)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    example: DEFAULT_PAGE_LIMIT,
    minimum: MIN_PAGE_LIMIT,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Transform(numberOrDefault(DEFAULT_PAGE_LIMIT))
  @IsInt()
  @Min(MIN_PAGE_LIMIT)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}

/** Query params for GET /analysis/trending (offset-based, unlike search). */
export class TrendingQueryDto {
  @ApiPropertyOptional({
    example: DEFAULT_PAGE_LIMIT,
    minimum: MIN_PAGE_LIMIT,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Transform(numberOrDefault(DEFAULT_PAGE_LIMIT))
  @IsInt()
  @Min(MIN_PAGE_LIMIT)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({
    example: DEFAULT_OFFSET,
    minimum: MIN_OFFSET,
    maximum: MAX_OFFSET,
    default: DEFAULT_OFFSET,
  })
  @IsOptional()
  @Transform(numberOrDefault(DEFAULT_OFFSET))
  @IsInt()
  @Min(MIN_OFFSET)
  @Max(MAX_OFFSET)
  offset: number = DEFAULT_OFFSET;
}

export class AnalysisResponse extends BaseResponse {
  @ApiProperty({
    type: 'object',
    properties: {
      song: { type: SongMetadataDto },
      analysis: { type: DetailedAnalysisDto },
      fromCache: { type: 'boolean' }
    }
  })
  data: {
    song: SongMetadataDto;
    analysis: DetailedAnalysisDto;
    fromCache: boolean;
  };
}