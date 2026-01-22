/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

/* Applicaiton Package */
import { ISongMetadata } from "../interfaces/analysis.interface";
import { IPaginatedResult } from "src/shared/constants/paginatedResult";
import { ISpotifySong, ISpotifyArtist } from "../interfaces/music.interface";

@Injectable()
export class SpotifyService {
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;

  constructor(private readonly configService: ConfigService) { }

  private async getAccessToken(): Promise<Result<string, string>> {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiresAt) return Ok(this.accessToken);

    try {
      const clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID');
      const clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET');

      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (response.status === 200 && response.data.access_token) {
        this.accessToken = response.data.access_token;
        this.tokenExpiresAt = now + response.data.expires_in * 1000;

        return Ok(this.accessToken);
      }

      return Err('Không thể lấy token từ Spotify.');
    } catch (error) {
      return Err('Lỗi xác thực Spotify.');
    }
  }

  async search(
    query: string,
    page: number = 1,
    limit: number = 10
  ): Promise<Result<IPaginatedResult<ISongMetadata>, string>> {
    const tokenRes = await this.getAccessToken();
    if (tokenRes.isErr()) return Err(tokenRes.unwrapErr());

    const offset = (page - 1) * limit;

    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        headers: { 
          Authorization: `Bearer ${tokenRes.unwrap()}`
        },
        params: {
          q: query,
          type: 'track',
          limit: limit,
          offset: offset
        },
      });

      if (response.status !== 200 || !response.data.tracks) {
        return Err('Lỗi khi tìm kiếm bài hát trên Spotify.');
      }

      const { items, total } = response.data.tracks;

      const tracks: ISongMetadata[] = items?.map((item: ISpotifySong) => ({
        id: item.id,
        title: item.name,
        artist: item.artists.map((a: ISpotifyArtist) => a.name).join(', '),
        album: item.album.name,
        imageUrl: item.album.images[0]?.url ?? '',
        spotifyUrl: item.external_urls.spotify,
      }));

      return Ok({
        items: tracks,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      return Err('Lỗi khi tìm kiếm bài hát trên Spotify.');
    }
  }
}