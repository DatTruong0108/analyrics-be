export interface ISongMetadata {
  id: string; // Spotify ID or UUID
  title: string;
  artist: string;
  album: string;
  imageUrl: string;
  spotifyUrl: string;
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
  vibe: string;
  overview: string;
  analysis: IAnalysisSection[];
  metaphors: IMetaphor[];
  coreMessage: string;
}