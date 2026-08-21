/**
 * Chuẩn hoá metadata bài hát lấy từ Spotify thành khoá tra cứu dùng chung
 * (LrcLib + Google Search). Tên bài hát trên Spotify thường mang theo hậu tố
 * "(feat. ...)", "- Remastered", ... khiến việc khớp chính xác luôn thất bại.
 */

/* Các từ khoá đánh dấu phần "nhiễu" trong tên bài hát */
const NOISE_KEYWORDS =
  "feat|ft|featuring|with|prod|remaster|remastered|version|ver|live|explicit|instrumental|deluxe|bonus|remix|cover|edit|mix|ost";

/* Các dấu phân tách nhiều nghệ sĩ trong một chuỗi */
const ARTIST_SEPARATOR = /\s*(?:,|&|;|\/|\||\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\band\b)\s*/i;

/**
 * Bỏ các hậu tố nhiễu khỏi tên bài hát.
 * VD: `THẾ GIỚI CỦA ANH (feat. Dương Domic, WEAN)` -> `THẾ GIỚI CỦA ANH`
 */
export function cleanSongTitle(title: string): string {
  const bracketNoise = new RegExp(`\\s*[([][^()[\\]]*\\b(?:${NOISE_KEYWORDS})\\b[^()[\\]]*[)\\]]`, "gi");
  const dashNoise = new RegExp(`\\s*-\\s*(?:${NOISE_KEYWORDS})\\b.*$`, "i");

  const cleaned = title
    .replace(bracketNoise, "")
    .replace(dashNoise, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  /* Không trả về chuỗi rỗng nếu toàn bộ tên bài hát đều bị coi là nhiễu */
  return cleaned.length > 0 ? cleaned : title.trim();
}

/**
 * Tách chuỗi nghệ sĩ thành danh sách tên riêng lẻ.
 * VD: `TINH HÀ "SAY HI", Dương Domic, WEAN` -> ["TINH HÀ SAY HI", "Dương Domic", "WEAN"]
 */
export function extractArtistNames(artist: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const raw of artist.split(ARTIST_SEPARATOR)) {
    const name = raw.replace(/["“”'']/g, "").replace(/\s{2,}/g, " ").trim();
    if (name.length < 2) continue;

    const key = normalizeForCompare(name);
    if (key.length === 0 || seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names.length > 0 ? names : [artist.trim()];
}

/**
 * Hạ chuẩn chuỗi để so khớp: bỏ dấu tiếng Việt, hạ chữ thường, bỏ ký tự đặc biệt.
 */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Chuyển lời có timestamp (LRC) thành lời thuần.
 * VD: `[00:12.34] Câu hát` -> `Câu hát`
 */
export function stripLrcTimestamps(syncedLyrics: string): string {
  return syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
