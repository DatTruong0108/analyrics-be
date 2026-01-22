/* System Package */
import { Result } from "oxide.ts";

/* Application Package */
import { IAnalysisResult, ISongMetadata, ITrendingSongs } from "../interfaces/analysis.interface";
import { AnalysisWithSong } from "./analysis.repository.impl";

export abstract class IAnalysisRepository {
  abstract findAnalysisBySongId(songId: string): Promise<Result<AnalysisWithSong | null, string>>;
  abstract saveAnalysis(song: ISongMetadata, analysis: IAnalysisResult): Promise<Result<void, string>>;
  abstract findTrendings(limit: number, offset: number): Promise<Result<ITrendingSongs, string>>;
}