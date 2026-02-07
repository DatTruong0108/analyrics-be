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
  private readonly ITUNES_API = 'https://itunes.apple.com/search';
  private readonly DEEZER_API = 'https://api.deezer.com/search';

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

  async getPreviewUrl(title: string, artist: string): Promise<Result<string | null, string>> {
    try {
      // const itunesRes = await this.getPreviewUrlFromItunes(title, artist);
      // if (itunesRes.isOk()) return itunesRes;

      const deezerRes = await this.getPreviewUrlFromDeezer(title, artist);
      if (deezerRes.isOk()) return deezerRes;

      return Err('Không tìm thấy link xem trước của bài hát');
    } catch (error) {
      return Err('Lỗi khi tìm kiếm link xem trước của bài hát');
    }
  }

  private async getPreviewUrlFromItunes(title: string, artist: string): Promise<Result<string | null, string>> {
    try {
      const term = encodeURIComponent(`${artist} ${title}`);
      const response = await axios.get(`${this.ITUNES_API}`, {
        params: {
          term,
          entity: 'song',
          limit: 1,
          lang: 'vi-VN',
          country: 'VN'
        }
      });

      if (response.status !== 200) {
        return Err('Lỗi khi tìm kiếm link xem trước của bài hát');
      }

      if (response.data?.results?.length > 0) {
        return Ok(response.data.results[0].previewUrl);
      }

      return Err('Không tìm thấy link xem trước của bài hát');
    } catch (error) {
      return Err('Lỗi khi tìm kiếm link xem trước của bài hát');
    }
  }

  private async getPreviewUrlFromDeezer(title: string, artist: string): Promise<Result<string | null, string>> {
    try {
      const term = encodeURIComponent(`${artist} ${title}`);
      const response = await axios.get(`${this.DEEZER_API}`, {
        params: {
          q: term,
          limit: 1
        }
      });

      if (response.status !== 200) {
        return Err('Lỗi khi tìm kiếm link xem trước của bài hát');
      }

      if (response.data?.data?.length > 0) {
        return Ok(response.data.data[0].preview);
      }

      return Err('Không tìm thấy link xem trước của bài hát');
    } catch (error) {
      return Err('Lỗi khi tìm kiếm link xem trước của bài hát');
    }
  }
}