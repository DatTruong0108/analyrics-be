/* eslint-disable @typescript-eslint/no-unused-vars */
/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";
import { Prisma } from "@prisma/client";

/* Application Package */
import { IAnalysisRepository } from "./analysis.repository";
import { IAnalysisResult, ISongMetadata, IAnalysisSection, IMetaphor, ITrendingSongs } from "../interfaces/analysis.interface";
import { PrismaService } from "src/prisma/prisma.service";

export type AnalysisWithSong = IAnalysisResult & { song: ISongMetadata };

@Injectable()
export class AnalysisRepositoryImpl implements IAnalysisRepository {
  constructor(private readonly prismaService: PrismaService) { }

  async findAnalysisBySongId(songId: string): Promise<Result<AnalysisWithSong | null, string>> {
    try {
      const record = await this.prismaService.analysis.findUnique({
        where: { songId },
        include: { song: true },
      });
      if (!record) return Ok(null);
      const formattedResult: AnalysisWithSong = {
        fullLyrics: record.fullLyrics,
        vibe: record.vibe,
        overview: record.overview,
        coreMessage: record.coreMessage,
        // Ép kiểu trực tiếp từ Prisma Json sang Interface cụ thể
        analysis: record.sections as unknown as IAnalysisSection[],
        metaphors: record.metaphors as unknown as IMetaphor[],
        song: {
          id: record.song.id,
          title: record.song.title,
          artist: record.song.artist,
          album: record.song.album,
          imageUrl: record.song.imageUrl,
          spotifyUrl: record.song.spotifyUrl,
        },
      };

      return Ok(formattedResult);
    } catch { return Err('Lỗi truy vấn cơ sở dữ liệu.'); }
  }

  async saveAnalysis(userId: string | null, song: ISongMetadata, analysis: IAnalysisResult): Promise<Result<void, string>> {
    try {
      await this.prismaService.$transaction(async (tx) => {
        // 1. Lưu hoặc cập nhật thông tin bài hát (Metadata)
        await tx.song.upsert({
          where: { id: song.id },
          update: {
            title: song.title,
            artist: song.artist,
            album: song.album,
            imageUrl: song.imageUrl,
            spotifyUrl: song.spotifyUrl,
          },
          create: {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            imageUrl: song.imageUrl,
            spotifyUrl: song.spotifyUrl,
          },
        });

        // 2. Kiểm tra/Tạo bản phân tích dùng chung (Shared Analysis)
        let analysisRecord = await tx.analysis.findUnique({
          where: { songId: song.id },
        });

        if (!analysisRecord) {
          analysisRecord = await tx.analysis.create({
            data: {
              songId: song.id,
              fullLyrics: analysis.fullLyrics,
              vibe: analysis.vibe,
              overview: analysis.overview,
              coreMessage: analysis.coreMessage,
              sections: analysis.analysis as unknown as Prisma.InputJsonValue,
              metaphors: analysis.metaphors as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // 3. Ghi vết vào lịch sử cá nhân (UserHistory)
        // Dùng upsert để nếu người dùng xem lại bài này, thời gian createdAt sẽ được cập nhật mới nhất
        if (userId) {
          await tx.userHistory.upsert({
            where: {
              userId_analysisId: {
                userId: userId,
                analysisId: analysisRecord.id,
              },
            },
            update: { createdAt: new Date() },
            create: {
              userId: userId,
              analysisId: analysisRecord.id,
            },
          });
        }
      });

      return Ok(undefined);
    } catch (error) {
      console.error('Save Analysis Transaction Error:', error);
      return Err('Lỗi khi lưu trữ dữ liệu vào hệ thống.');
    }
  }

  async recordUserHistory(userId: string, analysisId: string): Promise<void> {
    try {
      await this.prismaService.userHistory.upsert({
        where: {
          userId_analysisId: {
            userId,
            analysisId,
          },
        },
        update: { createdAt: new Date() }, // Đưa bài hát lên đầu danh sách
        create: {
          userId,
          analysisId,
        },
      });
    } catch (error) {
      console.error('Record History Error:', error);
    }
  }

  async findTrendings(limit: number = 10, offset: number): Promise<Result<ITrendingSongs, string>> {
    try {
      const items = await this.prismaService.analysis.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { song: true },
      });

      const total = await this.prismaService.analysis.count();

      const formattedItems: ISongMetadata[] = items.map(record => ({
        id: record.song.id,
        title: record.song.title,
        artist: record.song.artist,
        album: record.song.album,
        imageUrl: record.song.imageUrl,
        spotifyUrl: record.song.spotifyUrl,
      }));

      return Ok({
        items: formattedItems,
        total
      });
    } catch (error) {
      return Err('Lỗi truy xuất bài hát thịnh hành.');
    }
  }

  async findUserHistory(userId: string, limit: number, offset: number): Promise<Result<ITrendingSongs, string>> {
    try {
      const [history, total] = await this.prismaService.$transaction([
        this.prismaService.userHistory.findMany({
          where: { userId },
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          include: {
            analysis: {
              include: { song: true }
            }
          },
        }),
        this.prismaService.userHistory.count({ where: { userId } }),
      ]);

      const formattedItems: ISongMetadata[] = history.map(record => ({
        id: record.analysis.song.id,
        title: record.analysis.song.title,
        artist: record.analysis.song.artist,
        album: record.analysis.song.album,
        imageUrl: record.analysis.song.imageUrl,
        spotifyUrl: record.analysis.song.spotifyUrl,
      }));

      return Ok({
        items: formattedItems,
        total
      });
    } catch (e) {
      return Err('Lỗi truy vấn lịch sử.');
    }
  }
}