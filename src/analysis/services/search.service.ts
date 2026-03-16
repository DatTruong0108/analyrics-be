/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
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
  private readonly ITUNES_API = 'https://itunes.apple.com/search';
  private readonly DEEZER_API = 'https://api.deezer.com/search';

  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /* Get Spotify access token using Client Credentials Flow */
  private async getAccessToken(): Promise<Result<string | null, string>> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return Ok(this.accessToken);
    }
    try {
      const clientId = process.env.SPOTIFY_CLIENT_ID;
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
      const authUrl = process.env.SPOTIFY_AUTH_URL || 'https://accounts.spotify.com/api/token';

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');

      const response = await axios.post(authUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        }
      })

      if (response.status === 200) {
        const data = response.data;
        this.accessToken = data.access_token;
        this.tokenExpiresAt = now + (data.expires_in * 1000) - (60 * 1000);

        if (!this.accessToken) {
          return Err('Không nhận được access token từ Spotify');
        }

        return Ok(this.accessToken);
      }

      return Err('Lỗi khi lấy access token từ Spotify');
    } catch (error) {
      return Err('Lỗi khi lấy access token từ Spotify');
    }
  }

  async search(query: string, page: number = 1, limit: number = 1): Promise<Result<IPaginatedResult<ISongMetadata>, string>> {
    try {
      const token = await this.getAccessToken();
      if (token.isErr()) {
        return Err(token.unwrapErr());
      }

      const response = await axios.get(process.env.SPOTIFY_SEARCH_URL || 'https://api.spotify.com/v1/search', {
        headers: {
          Authorization: `Bearer ${token.unwrap()}`
        },
        params: {
          q: query,
          type: 'track',
          limit: limit,
          offset: (page - 1) * limit
        }
      });

      if (response.status !== 200) {
        return Err('Lỗi khi tìm kiếm bài hát từ Spotify.');
      }

      const tracks = response.data?.tracks?.items || [];
      const songs: ISongMetadata[] = tracks.map((track: any) => ({
        id: track.id,
        title: track.name,
        artist: track.artists.map((a: any) => a.name).join(', '),
        album: track.album.name,
        imageUrl: track.album.images[0]?.url || '',
        spotifyUrl: track.external_urls.spotify,
        previewUrl: track.preview_url || null, 
      }));

      return Ok({
        items: songs,
        total: response.data.tracks.total,
        page,
        limit,
        totalPages: Math.ceil(response.data.tracks.total / limit),
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