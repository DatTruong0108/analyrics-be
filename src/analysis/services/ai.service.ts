/* System Package */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Result, Ok, Err } from "oxide.ts";
import {
  FinishReason,
  GenerateContentRequest,
  GenerateContentResult,
  GenerativeModel,
  GoogleGenerativeAI,
  ResponseSchema,
  SchemaType,
} from "@google/generative-ai";

/* Application Package */
import { IAnalysisResult } from "../interfaces/analysis.interface";
import { cleanSongTitle, extractArtistNames } from "../utils/song-key.util";

/**
 * SDK @google/generative-ai@0.24 chưa khai báo tool "googleSearch" của Gemini 2.x
 * (chỉ có "googleSearchRetrieval" của Gemini 1.5) nên phải mở rộng type request.
 */
type GoogleSearchTool = { googleSearch: Record<string, never> };
type GroundedRequest = GenerateContentRequest & { tools?: GoogleSearchTool[] };

interface IGenerativeAIError {
  status?: number;
  statusText?: string;
  message?: string;
}

/* fullLyrics/syncedLyrics do backend tự gán, không để AI sinh lại */
type IAnalysisPayload = Omit<IAnalysisResult, "fullLyrics" | "syncedLyrics">;

const LYRICS_START_MARKER = "<<<LYRICS>>>";
const LYRICS_END_MARKER = "<<<END>>>";
const LYRICS_NOT_FOUND = "LYRICS_NOT_FOUND";

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly MAX_WEB_SEARCH_ATTEMPTS = 2;
  private readonly MAX_ANALYSIS_ATTEMPTS = 2;
  private readonly MIN_LYRICS_LENGTH = 80;
  private readonly hasApiKey: boolean;
  private readonly model: GenerativeModel;

  /**
   * responseSchema buộc Gemini trả JSON đúng cấu trúc ở tầng API, nhờ vậy prompt
   * không cần nhắc "chỉ trả RAW JSON, không markdown" nữa.
   */
  private readonly ANALYSIS_SCHEMA: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      vibe: {
        type: SchemaType.STRING,
        description: "2-4 từ khoá cảm xúc chủ đạo, phân tách bằng dấu phẩy, tiếng Việt",
      },
      overview: {
        type: SchemaType.STRING,
        description: "1-2 câu về ý nghĩa cốt lõi của bài hát",
      },
      analysis: {
        type: SchemaType.ARRAY,
        description: "Phân tích từng đoạn theo đúng thứ tự xuất hiện trong lời bài hát",
        items: {
          type: SchemaType.OBJECT,
          properties: {
            section: {
              type: SchemaType.STRING,
              description: "Intro | Verse 1..n | Pre-Chorus | Chorus | Post-Chorus | Bridge | Hook | Rap Verse | Outro",
            },
            lyricsQuote: {
              type: SchemaType.STRING,
              description: "Trích nguyên văn lời của đoạn, tối đa 7 dòng",
            },
            content: {
              type: SchemaType.STRING,
              description: "2-3 câu phân tích ý nghĩa và thủ pháp của đoạn",
            },
          },
          required: ["section", "lyricsQuote", "content"],
        },
      },
      metaphors: {
        type: SchemaType.ARRAY,
        description: "3-6 ẩn dụ / tiếng lóng / chơi chữ / điển tích đắt giá nhất",
        items: {
          type: SchemaType.OBJECT,
          properties: {
            phrase: { type: SchemaType.STRING, description: "Cụm từ trích nguyên văn từ lời bài hát" },
            meaning: { type: SchemaType.STRING, description: "1-2 câu giải nghĩa gốc và ý nghĩa trong bài" },
          },
          required: ["phrase", "meaning"],
        },
      },
      coreMessage: {
        type: SchemaType.STRING,
        description: "Đúng 1 câu về thông điệp cốt lõi",
      },
    },
    required: ["vibe", "overview", "analysis", "metaphors", "coreMessage"],
  };

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("AI_API_KEY") || "";
    this.hasApiKey = apiKey.trim().length > 0;

    if (!this.hasApiKey) {
      this.logger.error("Thiếu biến môi trường AI_API_KEY, mọi yêu cầu phân tích sẽ thất bại.");
    }

    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: "gemini-2.5-flash",
    });
  }

  async analyzeLyrics(title: string, artist: string, lyrics: string): Promise<Result<IAnalysisResult, string>> {
    if (!this.hasApiKey) {
      return Err("Hệ thống AI chưa được cấu hình (thiếu AI_API_KEY).");
    }

    let resolvedLyrics = (lyrics || "").trim();

    /* Không có lời từ LrcLib -> nhờ Gemini tra cứu bằng Google Search */
    if (resolvedLyrics.length === 0) {
      const webLyricsRes = await this.fetchLyricsFromWeb(title, artist);
      if (webLyricsRes.isErr()) return Err(webLyricsRes.unwrapErr());
      resolvedLyrics = webLyricsRes.unwrap();
    }

    if (resolvedLyrics.length === 0) {
      return Err("Không tìm thấy lời bài hát từ các nguồn web. Vui lòng thử lại sau.");
    }

    const analysisRes = await this.requestAnalysis(title, artist, resolvedLyrics);
    if (analysisRes.isErr()) return Err(analysisRes.unwrapErr());

    const payload = analysisRes.unwrap();

    /* Lời bài hát lấy từ nguồn gốc, không dùng bản AI chép lại */
    return Ok({
      fullLyrics: resolvedLyrics,
      syncedLyrics: null,
      vibe: payload.vibe,
      overview: payload.overview,
      analysis: payload.analysis,
      metaphors: payload.metaphors,
      coreMessage: payload.coreMessage,
    });
  }

  /**
   * Bước tra cứu lời bằng Google Search grounding.
   * Ok("") nghĩa là không tìm được, Err là lỗi hệ thống cần báo người dùng.
   *
   * LƯU Ý: Gemini KHÔNG cho phép dùng tools cùng responseMimeType = application/json
   * (lỗi 400: Tool use with a response mime type: application/json is unsupported),
   * vì vậy bước này chỉ trả text thuần, phần JSON được tách sang requestAnalysis().
   */
  private async fetchLyricsFromWeb(title: string, artist: string): Promise<Result<string, string>> {
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= this.MAX_WEB_SEARCH_ATTEMPTS; attempt++) {
      try {
        const request: GroundedRequest = {
          contents: [
            {
              role: "user",
              parts: [{ text: this.buildLyricsSearchPrompt(title, artist, attempt) }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
          tools: [{ googleSearch: {} }],
        };

        const result = await this.model.generateContent(request);
        const textRes = this.extractText(result);

        if (textRes.isErr()) {
          lastError = textRes.unwrapErr();
          continue;
        }

        const lyrics = this.extractMarkedLyrics(textRes.unwrap());
        if (lyrics.length >= this.MIN_LYRICS_LENGTH) return Ok(lyrics);

        this.logger.warn(`Không tra được lời bài hát cho "${title}" (lần ${attempt}).`);
      } catch (error) {
        lastError = this.mapAIError(error, `tra cứu lời lần ${attempt}`);
        if (this.isFatalError(error)) return Err(lastError);
      }
    }

    return lastError ? Err(lastError) : Ok("");
  }

  /* Bước phân tích: JSON mode + responseSchema, tuyệt đối không kèm tools */
  private async requestAnalysis(
    title: string,
    artist: string,
    lyrics: string,
  ): Promise<Result<IAnalysisPayload, string>> {
    let lastError = "Hệ thống AI gặp sự cố khi xử lý lời bài hát.";

    for (let attempt = 1; attempt <= this.MAX_ANALYSIS_ATTEMPTS; attempt++) {
      try {
        const request: GenerateContentRequest = {
          contents: [
            {
              role: "user",
              parts: [{ text: this.buildAnalysisPrompt(title, artist, lyrics) }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: this.ANALYSIS_SCHEMA,
            temperature: 0.6,
            maxOutputTokens: 32768,
          },
        };

        const result = await this.model.generateContent(request);
        const textRes = this.extractText(result);

        if (textRes.isErr()) {
          lastError = textRes.unwrapErr();
          continue;
        }

        const parsedRes = this.parseAnalysisResponse(textRes.unwrap());
        if (parsedRes.isErr()) {
          lastError = parsedRes.unwrapErr();
          continue;
        }

        return Ok(parsedRes.unwrap());
      } catch (error) {
        lastError = this.mapAIError(error, `phân tích lần ${attempt}`);
        if (this.isFatalError(error)) return Err(lastError);
      }
    }

    return Err(lastError);
  }

  /**
   * Lấy text từ response mà không dùng response.text() - hàm đó throw khi
   * candidate bị chặn (RECITATION/SAFETY), làm mất ngữ cảnh lỗi thật.
   */
  private extractText(result: GenerateContentResult): Result<string, string> {
    const blockReason = result.response?.promptFeedback?.blockReason;
    if (blockReason) {
      this.logger.error(`Prompt bị AI từ chối (blockReason: ${blockReason}).`);
      return Err("Yêu cầu phân tích bị bộ lọc an toàn của AI từ chối.");
    }

    const candidate = result.response?.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason === FinishReason.RECITATION) {
      this.logger.warn("AI chặn kết quả do RECITATION (sao chép nguyên văn nội dung có bản quyền).");
      return Err("AI bị chặn khi sao chép nguyên văn lời bài hát. Vui lòng thử lại sau.");
    }

    if (
      finishReason === FinishReason.SAFETY ||
      finishReason === FinishReason.PROHIBITED_CONTENT ||
      finishReason === FinishReason.BLOCKLIST ||
      finishReason === FinishReason.SPII
    ) {
      this.logger.warn(`AI chặn kết quả (finishReason: ${finishReason}).`);
      return Err("Nội dung bài hát bị bộ lọc an toàn của AI từ chối.");
    }

    if (finishReason === FinishReason.MAX_TOKENS) {
      this.logger.warn("Kết quả AI bị cắt ngắn do vượt giới hạn token.");
      return Err("Hệ thống AI trả về kết quả bị cắt ngắn. Vui lòng thử lại.");
    }

    const text = (candidate?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (text.length === 0) {
      this.logger.warn(`AI trả về nội dung rỗng (finishReason: ${finishReason ?? "không rõ"}).`);
      return Err("AI không trả về kết quả phân tích.");
    }

    return Ok(text);
  }

  private extractMarkedLyrics(responseText: string): string {
    if (responseText.includes(LYRICS_NOT_FOUND)) return "";

    const start = responseText.indexOf(LYRICS_START_MARKER);
    const end = responseText.lastIndexOf(LYRICS_END_MARKER);
    const body =
      start !== -1 && end > start
        ? responseText.slice(start + LYRICS_START_MARKER.length, end)
        : responseText;

    return body
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }

  private parseAnalysisResponse(responseText: string): Result<IAnalysisPayload, string> {
    const structureError = "Kết quả phân tích từ AI không đúng cấu trúc yêu cầu.";
    let raw: IAnalysisPayload;

    try {
      raw = JSON.parse(this.isolateJson(responseText)) as IAnalysisPayload;
    } catch {
      this.logger.warn(`Không parse được JSON từ AI: ${responseText.slice(0, 200)}`);
      return Err(structureError);
    }

    const vibe = (raw.vibe || "").trim();
    const overview = (raw.overview || "").trim();
    const coreMessage = (raw.coreMessage || "").trim();
    const analysis = Array.isArray(raw.analysis)
      ? raw.analysis.filter((section) => section && section.section && section.content)
      : [];
    const metaphors = Array.isArray(raw.metaphors)
      ? raw.metaphors.filter((metaphor) => metaphor && metaphor.phrase && metaphor.meaning)
      : [];

    if (vibe.length === 0 || overview.length === 0 || analysis.length === 0) {
      this.logger.warn("Kết quả AI thiếu trường bắt buộc (vibe/overview/analysis).");
      return Err(structureError);
    }

    return Ok({ vibe, overview, analysis, metaphors, coreMessage });
  }

  /* Phòng trường hợp model vẫn bọc JSON trong markdown dù đã bật JSON mode */
  private isolateJson(responseText: string): string {
    const cleaned = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (cleaned.startsWith("{")) return cleaned;

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd <= jsonStart) return cleaned;

    return cleaned.slice(jsonStart, jsonEnd + 1);
  }

  private mapAIError(error: unknown, scope: string): string {
    const aiError = error as IGenerativeAIError;
    const status = aiError?.status;
    const message = aiError?.message || String(error);

    this.logger.error(`Gemini thất bại khi ${scope} (status: ${status ?? "không rõ"}): ${message}`);

    if (status === 429) {
      return "Hệ thống AI đang bận (hết hạn mức). Vui lòng thử lại sau giây lát.";
    }
    if (status === 503 || status === 500) {
      return "Hệ thống AI đang quá tải. Vui lòng thử lại sau giây lát.";
    }
    if (status === 401 || status === 403) {
      return "Hệ thống AI chưa được cấu hình đúng (khóa API không hợp lệ).";
    }
    if (status === 400) {
      return "Hệ thống AI từ chối yêu cầu phân tích. Vui lòng liên hệ quản trị viên.";
    }
    if (/RECITATION/i.test(message)) {
      return "AI bị chặn khi sao chép nguyên văn lời bài hát. Vui lòng thử lại sau.";
    }

    return "Hệ thống AI gặp sự cố khi xử lý lời bài hát.";
  }

  /* Lỗi cấu hình hoặc quyền truy cập: thử lại cũng vô ích */
  private isFatalError(error: unknown): boolean {
    const status = (error as IGenerativeAIError)?.status;
    return status === 400 || status === 401 || status === 403;
  }

  private buildLyricsSearchPrompt(title: string, artist: string, attempt: number): string {
    const cleanedTitle = cleanSongTitle(title);
    const artistNames = extractArtistNames(artist);
    const primaryArtists = artistNames.slice(0, 3).join(", ");
    const broaden =
      attempt > 1
        ? '4. Lần này hãy nới lỏng điều kiện: tìm bằng tên bài hát rút gọn không kèm nghệ sĩ, thử tên bài hát không dấu, thêm từ khoá "lyric video" hoặc "lời".'
        : "";

    return `Nhiệm vụ: dùng Google Search để tìm và trích xuất TOÀN BỘ lời bài hát.

      THÔNG TIN BÀI HÁT
      - Tên gốc: "${title}"
      - Tên đã chuẩn hoá (ưu tiên dùng khi tìm kiếm): "${cleanedTitle}"
      - Nghệ sĩ: ${primaryArtists}

      CHIẾN LƯỢC TÌM KIẾM (lần ${attempt}/${this.MAX_WEB_SEARCH_ATTEMPTS})
      1. Tìm lần lượt với các truy vấn: "${cleanedTitle} lời bài hát", "${cleanedTitle} ${artistNames[0]} lyrics", "${cleanedTitle} lyrics genius".
      2. Ưu tiên nguồn: Genius, Musixmatch, Zing MP3, NhacCuaTui, Lyrics.vn, phần mô tả video trên YouTube.
      3. Chỉ nhận trang có lời ĐẦY ĐỦ; nếu trang đầu bị thiếu, mở trang khác để đối chiếu.
      ${broaden}

      ĐỊNH DẠNG ĐẦU RA (bắt buộc)
      - Nếu tìm được: in ra DUY NHẤT lời bài hát, đặt giữa hai dòng mốc:
      ${LYRICS_START_MARKER}
      (lời bài hát, giữ nguyên thứ tự và dấu xuống dòng)
      ${LYRICS_END_MARKER}
      - Nếu không tìm được lời đầy đủ và đáng tin cậy: in ra duy nhất ${LYRICS_NOT_FOUND}
      - Không thêm tiêu đề, chú thích, nguồn tham khảo, markdown hay bất kỳ bình luận nào.
      - KHÔNG tự bịa, KHÔNG suy đoán, KHÔNG dịch và KHÔNG rút gọn lời bài hát.`;
  }

  private buildAnalysisPrompt(title: string, artist: string, lyrics: string): string {
    return `VAI TRÒ
      Bạn là nhà phê bình âm nhạc và nhà ngôn ngữ học người Việt, thông thạo văn hoá đại chúng Việt Nam, tiếng lóng Gen Z, đồng thời am hiểu điển tích trong nhạc truyền thống.

      BÀI HÁT
      - Tên: "${title}"
      - Nghệ sĩ: "${artist}"

      LỜI BÀI HÁT (nguồn duy nhất được phép dùng để phân tích)
      ---
      ${lyrics}
      ---

      NHIỆM VỤ
      1. Tự xác định thể loại chủ đạo rồi áp dụng đúng lăng kính phân tích:
        - RAP/HIP-HOP: bóc tách wordplay, pun, punchline, tiếng lóng, cách gieo vần và flow; chỉ rõ từng lớp nghĩa.
        - POP/BALLAD/INDIE: mạch cảm xúc, tuyến truyện, mối liên hệ giữa hình ảnh và tâm trạng.
        - CẢI LƯƠNG/DÂN CA/NHẠC XƯA: điển tích điển cố, từ Hán Việt, tính triết lý và nhân văn.
        - NHẠC QUỐC TẾ (US-UK, K-Pop, C-Pop...): giải nghĩa trong ngữ cảnh văn hoá bản địa rồi diễn giải sang tiếng Việt.
      2. Chia bài theo cấu trúc thật của lời và phân tích tuần tự từ đầu đến cuối, không bỏ sót đoạn nào.

      QUY TẮC BẮT BUỘC
      - Chỉ dựa vào lời bài hát ở trên. KHÔNG suy đoán, KHÔNG thêm câu hát không có trong lời.
      - Mọi nội dung phân tích viết bằng tiếng Việt (giữ nguyên văn phần trích dẫn lời và tên section).
      - Văn phong khách quan, sâu sắc, hiện đại; không sáo rỗng, không khen suông, không lặp ý giữa overview - analysis - coreMessage.

      ĐẶC TẢ TỪNG TRƯỜNG
      - vibe: 2-4 từ khoá cảm xúc chủ đạo, cách nhau bằng dấu phẩy, không có dấu chấm cuối. Ví dụ: "Suy, day dứt, chữa lành".
      - overview: 1-2 câu, tối đa 60 từ.
      - analysis: mỗi phần tử là một đoạn của bài, xếp theo đúng thứ tự xuất hiện.
        - section: chỉ dùng tên chuẩn tiếng Anh (Intro, Verse 1, Verse 2, Verse 3, Pre-Chorus, Chorus, Post-Chorus, Bridge, Hook, Rap Verse, Outro), đánh số tăng dần. Chorus lặp lại thì ghi "Chorus (lặp lại)". TUYỆT ĐỐI không dùng "Đoạn 1", "Phần mở đầu".
        - lyricsQuote: trích nguyên văn từ lời ở trên. Đoạn dưới 10 dòng thì trích toàn bộ, đoạn dài thì trích tối đa 7 dòng quan trọng nhất.
        - content: 2-3 câu, đi thẳng vào ý nghĩa và thủ pháp nổi bật của đoạn.
      - metaphors: 3-6 mục đắt giá nhất (ẩn dụ, tiếng lóng, chơi chữ, điển tích). phrase trích nguyên văn, meaning gồm 1-2 câu giải nghĩa gốc và ý nghĩa trong bài. Nếu bài hát không có gì đáng kể, trả về mảng rỗng.
      - coreMessage: đúng 1 câu, tối đa 40 từ.`;
  }
}
