import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { BaseResponse } from 'src/shared/constants/baseResponse';

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

export class AnalysisResponse extends BaseResponse {
  @ApiProperty({ 
    type: 'object',
    properties: {
      song: { type: SongMetadataDto },
      analysis: { type: DetailedAnalysisDto }
    }
  })
  data: {
    song: SongMetadataDto;
    analysis: DetailedAnalysisDto;
  };
}