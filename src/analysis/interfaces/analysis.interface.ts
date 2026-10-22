export interface ISongMetadata {
  id: string; // Spotify ID or UUID
  title: string;
  artist: string;
  album: string;
  imageUrl: string;
  spotifyUrl: string;
  previewUrl: string | null;
}

export interface IAnalysisSection {
  section: string;
  lyricsQuote: string;
  content: string;
}

export interface IMetaphor {
  phrase: string;
  meaning: string;
}

export interface IAnalysisResult {
  fullLyrics: string;
  syncedLyrics: string | null;
  vibe: string;
  overview: string;
  analysis: IAnalysisSection[];
  metaphors: IMetaphor[];
  coreMessage: string;
}

export interface ITrendingSongs {
  items: ISongMetadata[],
  total: number
}

/**
 * One row of a user's analysis history: the song plus when the user last
 * opened its analysis. `viewedAt` is `UserHistory.updatedAt`, which every
 * repeat view bumps, so it is "last viewed" rather than "first viewed".
 */
export interface IHistoryItem extends ISongMetadata {
  viewedAt: Date;
}

export interface IUserHistory {
  items: IHistoryItem[];
  total: number;
}
