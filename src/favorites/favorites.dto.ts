import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BaseResponse } from 'src/shared/constants/baseResponse';
import { MAX_SONG_ID_LENGTH } from 'src/shared/constants/song';
import { HistoryQueryDto, SongMetadataDto } from 'src/analysis/analysis.dto';

/** Path params for POST and DELETE /favorites/:songId. */
export class FavoriteSongParamDto {
  @ApiProperty({ example: '2up3OPMp9Tb4dAKM2erWXQ', description: 'ID bài hát' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SONG_ID_LENGTH)
  songId!: string;
}

/** Query params for GET /favorites — the same offset window as history. */
export class FavoritesQueryDto extends HistoryQueryDto { }

export class FavoriteItemDto extends SongMetadataDto {
  @ApiProperty({ example: '2026-10-22T08:30:00.000Z', description: 'Thời điểm người dùng thêm bài hát vào yêu thích' })
  favoritedAt!: Date;
}

export class FavoritesData {
  @ApiProperty({ type: [FavoriteItemDto] })
  items!: FavoriteItemDto[];

  @ApiProperty({ example: 12, description: 'Tổng số bài hát yêu thích' })
  total!: number;

  @ApiProperty({ example: true, description: 'Còn trang tiếp theo hay không' })
  hasMore!: boolean;
}

export class FavoritesResponse extends BaseResponse {
  @ApiProperty({ type: FavoritesData })
  data!: FavoritesData;
}

export class FavoriteStateData {
  @ApiProperty({ example: '2up3OPMp9Tb4dAKM2erWXQ' })
  songId!: string;

  @ApiProperty({ example: true, description: 'Trạng thái yêu thích sau thao tác' })
  isFavorited!: boolean;
}

export class FavoriteStateResponse extends BaseResponse {
  @ApiProperty({ type: FavoriteStateData })
  data!: FavoriteStateData;
}
