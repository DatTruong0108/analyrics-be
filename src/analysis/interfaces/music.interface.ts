export interface ISpotifySong {
  id: string;
  name: string;
  artists: ISpotifyArtist[];
  album: ISpotifyAlbum;
  external_urls: { 
    spotify: string
  };
}

export interface ISpotifyAlbum {
  id: string;
  name: string;
  images: {
    url: string;
    height: number;
    width: number;
  }[];
  external_urls: {
    spotify: string;
  }
}

export interface ISpotifyArtist {
  id: string;
  name: string;
  type: string;
  external_urls: {
    spotify: string;
  }
}

export interface ILyricsSource {
  lyrics: string;
  sourceUrl: string;
}