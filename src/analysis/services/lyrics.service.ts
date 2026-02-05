/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* System Package */
import { Injectable, Logger } from '@nestjs/common';
import { Result, Ok, Err } from 'oxide.ts';
import axios from 'axios';

@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);
  private readonly LRCLIB_API = 'https://lrclib.net/api/get';

  async getLyrics(title: string, artist: string): Promise<Result<{ plain: string, synced: string }, string>> {
    try {
      const response = await axios.get(process.env.GET_LYRICS_API || this.LRCLIB_API, {
        params: {
          track_name: title,
          artist_name: artist
        }
      });

      if (response.status !== 200) {
        return Err('Lỗi khi lấy lời bài hát từ hệ thống.');
      }

      const { plainLyrics, syncedLyrics } = response.data;

      return Ok({ plain: plainLyrics, synced: syncedLyrics });

    } catch (error) {
      this.logger.error(`Lyrics Service Error: ${error.message}`);
      return Err('Lỗi khi kết nối với Genius API.');
    }
  }
}
