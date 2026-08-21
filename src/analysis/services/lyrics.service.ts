/* System Package */
import { Injectable, Logger } from "@nestjs/common";
import { Result, Ok } from "oxide.ts";
import axios from "axios";

/* Application Package */
import {
  cleanSongTitle,
  extractArtistNames,
  normalizeForCompare,
  stripLrcTimestamps,
} from "../utils/song-key.util";

interface ILrcLibTrack {
  trackName: string;
  artistName: string;
  albumName: string | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface ILyrics {
  plain: string;
  synced: string;
}

@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);
  private readonly DEFAULT_GET_URL = "https://lrclib.net/api/get";
  private readonly REQUEST_TIMEOUT_MS = 8000;
  private readonly USER_AGENT = "analyrics (https://github.com/analyrics)";

  /**
   * Lấy lời bài hát từ LrcLib theo 2 bước:
   * 1. Khớp chính xác tên bài + nghệ sĩ (nhanh, đúng với metadata sạch).
   * 2. Tìm kiếm theo tên bài đã chuẩn hoá rồi tự chấm điểm kết quả.
   *
   * Metadata Spotify thường có dạng `TÊN BÀI (feat. A, B & C)` với chuỗi nghệ sĩ
   * gộp cả tên chương trình, nên bước 1 gần như luôn trả về 404 với nhạc Việt.
   */
  async getLyrics(title: string, artist: string): Promise<Result<ILyrics, string>> {
    const exactMatch = await this.fetchExactTrack(title, artist);
    if (exactMatch) return Ok(exactMatch);

    const cleanedTitle = cleanSongTitle(title);
    const artistNames = extractArtistNames(artist);
    const searchMatch = await this.searchBestMatch(cleanedTitle, artistNames);
    if (searchMatch) return Ok(searchMatch);

    this.logger.warn(
      `Không tìm thấy lời trên LrcLib cho "${title}" - "${artist}". Chuyển sang nhờ AI tra cứu.`,
    );
    return Ok({ plain: "", synced: "" });
  }

  /* Endpoint /api/get: khớp tuyệt đối tên bài + tên nghệ sĩ */
  private async fetchExactTrack(title: string, artist: string): Promise<ILyrics | null> {
    const track = await this.request<ILrcLibTrack>("/api/get", {
      track_name: title,
      artist_name: artist,
    });
    if (!track) return null;

    const lyrics = this.toLyrics(track);
    return lyrics.plain.length > 0 ? lyrics : null;
  }

  /* Endpoint /api/search: khớp mờ, cần tự lọc để không lấy lời của bài trùng tên */
  private async searchBestMatch(cleanedTitle: string, artistNames: string[]): Promise<ILyrics | null> {
    const results = await this.request<ILrcLibTrack[]>("/api/search", { track_name: cleanedTitle });
    if (!Array.isArray(results) || results.length === 0) return null;

    const titleKey = normalizeForCompare(cleanedTitle);
    const artistKeys = artistNames
      .map((name) => normalizeForCompare(name))
      .filter((key) => key.length >= 3);

    let bestTrack: ILrcLibTrack | null = null;
    let bestScore = 0;

    for (const track of results) {
      if (track.instrumental) continue;
      if (!track.plainLyrics && !track.syncedLyrics) continue;

      const trackTitleKey = normalizeForCompare(track.trackName || "");
      const trackArtistKey = normalizeForCompare(track.artistName || "");

      let score = 0;
      if (trackTitleKey === titleKey) score += 3;
      else if (trackTitleKey.includes(titleKey)) score += 2;
      else continue;

      /* Bắt buộc trùng ít nhất một nghệ sĩ: nhạc Việt có rất nhiều bài trùng tên */
      const isArtistMatched = artistKeys.some(
        (key) => trackArtistKey.includes(key) || key.includes(trackArtistKey),
      );
      if (!isArtistMatched) continue;

      score += 4;
      if (track.syncedLyrics) score += 1;
      if (track.plainLyrics) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestTrack = track;
      }
    }

    if (!bestTrack) return null;

    this.logger.log(`Khớp lời từ LrcLib: "${bestTrack.trackName}" - "${bestTrack.artistName}"`);
    const lyrics = this.toLyrics(bestTrack);
    return lyrics.plain.length > 0 ? lyrics : null;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const url = `${this.getApiBase()}${path}`;

    try {
      const response = await axios.get<T>(url, {
        params,
        timeout: this.REQUEST_TIMEOUT_MS,
        headers: { "User-Agent": this.USER_AGENT },
        validateStatus: () => true,
      });

      if (response.status !== 200) {
        this.logger.warn(`LrcLib ${path} trả về status ${response.status} (params: ${JSON.stringify(params)}).`);
        return null;
      }

      return response.data;
    } catch (error) {
      this.logger.warn(`Gọi LrcLib ${path} thất bại: ${String(error)}`);
      return null;
    }
  }

  /* LrcLib có thể trả plainLyrics = null trong khi vẫn có syncedLyrics */
  private toLyrics(track: ILrcLibTrack): ILyrics {
    const synced = (track.syncedLyrics || "").trim();
    const plain = (track.plainLyrics || "").trim() || (synced ? stripLrcTimestamps(synced) : "");
    return { plain, synced };
  }

  /* Cho phép cấu hình GET_LYRICS_API trỏ tới endpoint /api/get của một mirror */
  private getApiBase(): string {
    return (process.env.GET_LYRICS_API || this.DEFAULT_GET_URL)
      .trim()
      .replace(/\/api\/get\/?$/i, "")
      .replace(/\/+$/, "");
  }
}
