/* System Package */
import { Result } from "oxide.ts";

/* Application Package */
import { IAnalysisResult, ISongMetadata, ITrendingSongs, IUserHistory } from "../interfaces/analysis.interface";
import { AnalysisWithSong } from "./analysis.repository.impl";

export abstract class IAnalysisRepository {
  abstract findAnalysisBySongId(songId: string): Promise<Result<AnalysisWithSong | null, string>>;
  abstract findAnalysisIdBySongId(songId: string): Promise<Result<string | null, string>>;
  abstract saveAnalysis(userId: string | null, song: ISongMetadata, analysis: IAnalysisResult): Promise<Result<string, string>>;
  abstract findTrendings(limit: number, offset: number): Promise<Result<ITrendingSongs, string>>;
  abstract findUserHistory(userId: string, limit: number, offset: number): Promise<Result<IUserHistory, string>>;
  abstract recordUserHistory(userId: string, analysisId: string): Promise<void>;
  abstract deleteUserHistory(userId: string, songId: string): Promise<Result<number, string>>;
}