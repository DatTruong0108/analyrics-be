/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* System Package */
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Result, Ok, Err } from 'oxide.ts';

/* Application Package */
import { ISongMetadata } from '../interfaces/analysis.interface';
import { IPaginatedResult } from 'src/shared/constants/paginatedResult';

@Injectable()
export class SearchService {
  private readonly SEARCH_API = 'https://lyrics.quocvu.studio/api/search';

  async search(query: string, page: number = 1, limit: number = 1): Promise<Result<IPaginatedResult<ISongMetadata>, string>> {
    try {
      const response = await axios.get(process.env.SEARCH_API || this.SEARCH_API, {
        params: {
          q: query,
        }
      });

      if (response.status !== 200) {
        return Err('Lỗi khi tìm kiếm bài hát từ hệ thống.');
      }

      const songs: ISongMetadata[] = response.data?.songs;

      const startIndex = (page - 1) * limit;
      const paginatedItems = songs.slice(startIndex, startIndex + limit);

      return Ok({
        items: paginatedItems,
        total: songs.length,
        page,
        limit,
        totalPages: Math.ceil(songs.length / limit)
      });
    } catch (error) {
      return Err('Lỗi khi tìm kiếm bài hát từ hệ thống.');
    }
  }
}