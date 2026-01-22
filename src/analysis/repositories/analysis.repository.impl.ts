/* System Package */
import { Injectable } from "@nestjs/common";
import { Result, Ok, Err } from "oxide.ts";
import { Prisma } from "@prisma/client";

/* Application Package */
import { IAnalysisRepository } from "./analysis.repository";
import { IAnalysisResult, ISongMetadata, IAnalysisSection, IMetaphor } from "../interfaces/analysis.interface";
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

  async saveAnalysis(song: ISongMetadata, analysis: IAnalysisResult): Promise<Result<void, string>> {
    try {
      // Chuyển đổi từ Interface sang InputJsonValue để Prisma chấp nhận
      const sectionsJson = analysis.analysis as unknown as Prisma.InputJsonValue;
      const metaphorsJson = analysis.metaphors as unknown as Prisma.InputJsonValue;

      await this.prismaService.$transaction([
        this.prismaService.song.upsert({
          where: { id: song.id },
          update: { ...song },
          create: { ...song },
        }),
        this.prismaService.analysis.create({
          data: {
            songId: song.id,
            fullLyrics: analysis.fullLyrics,
            vibe: analysis.vibe,
            overview: analysis.overview,
            coreMessage: analysis.coreMessage,
            sections: sectionsJson,
            metaphors: metaphorsJson,
          },
        }),
      ]);
      return Ok(undefined);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return Err('Lỗi khi lưu trữ bản phân tích âm nhạc.');
    }
  }
}