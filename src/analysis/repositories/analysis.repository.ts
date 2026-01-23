/* System Package */
import { Result } from "oxide.ts";

/* Application Package */
import { IAnalysisResult, ISongMetadata, ITrendingSongs } from "../interfaces/analysis.interface";
import { AnalysisWithSong } from "./analysis.repository.impl";

export abstract class IAnalysisRepository {
  abstract findAnalysisBySongId(songId: string): Promise<Result<AnalysisWithSong | null, string>>;
  abstract saveAnalysis(userId: string | null, song: ISongMetadata, analysis: IAnalysisResult): Promise<Result<void, string>>;
  abstract findTrendings(limit: number, offset: number): Promise<Result<ITrendingSongs, string>>;
  abstract findUserHistory(userId: string, limit: number, offset: number): Promise<Result<ITrendingSongs, string>>;
  abstract recordUserHistory(userId: string, analysisId: string): Promise<void>;
}