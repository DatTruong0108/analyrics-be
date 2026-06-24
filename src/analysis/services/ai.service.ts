/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* System Package */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Result, Ok, Err } from "oxide.ts";
import { GenerateContentRequest, GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

/* Application Package */
import { IAnalysisResult } from "../interfaces/analysis.interface";

@Injectable()
export class AIService {
  private readonly MAX_WEB_SEARCH_ATTEMPTS = 4;
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: GenerativeModel;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("AI_API_KEY") || "";
    this.genAI = new GoogleGenerativeAI(apiKey);

    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
    })
  }

  async analyzeLyrics(title: string, artist: string, lyrics: string): Promise<Result<IAnalysisResult, string>> {
    try {
      const normalizedLyrics = lyrics.trim();
      const shouldUseWebSearch = normalizedLyrics === "";
      let parsedData: IAnalysisResult | null = null;

      if (shouldUseWebSearch) {
        for (let attempt = 1; attempt <= this.MAX_WEB_SEARCH_ATTEMPTS; attempt++) {
          const prompt = this.buildPrompt(title, artist, normalizedLyrics, attempt);
          const request: GenerateContentRequest & { tools?: Array<Record<string, unknown>> } = {
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
            },
            tools: [
              {
                googleSearch: {}
              }
            ]
          };

          const result = await this.model.generateContent(request);
          const responseText = result.response?.text();
          if (!responseText) continue;

          try {
            const candidate = this.parseAnalysisResponse(responseText);
            const fullLyrics = (candidate.fullLyrics || "").trim();
            if (fullLyrics.length > 0 && fullLyrics !== "LYRICS_NOT_FOUND") {
              parsedData = candidate;
              break;
            }
          } catch {
            // Retry the next attempt with a stronger prompt.
          }
        }
      } else {
        const prompt = this.buildPrompt(title, artist, normalizedLyrics);
        const request: GenerateContentRequest & { tools?: Array<Record<string, unknown>> } = {
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
          }
        };
        const result = await this.model.generateContent(request);
        const responseText = result.response?.text();

        if (!responseText) {
          return Err('AI không trả về kết quả phân tích.');
        }

        parsedData = this.parseAnalysisResponse(responseText);
      }

      if (!parsedData) {
        return Err('Không tìm thấy lời bài hát từ các nguồn web sau nhiều lần thử. Vui lòng thử lại sau.');
      }

      if (!parsedData.vibe || !Array.isArray(parsedData.analysis)) {
        return Err('Kết quả phân tích từ AI không đúng cấu trúc yêu cầu.');
      }

      return Ok(parsedData);
    } catch (error) {
      if (error?.status === 429) {
        console.error('⚠️ Bạn đã hết hạn mức sử dụng AI trong phút này. Vui lòng thử lại sau 20-30 giây.');
        return Err('Hệ thống AI đang bận (Hết hạn mức). Vui lòng thử lại sau giây lát.');
      }

      console.error('AIService Error:', error);
      return Err('Hệ thống AI gặp sự cố khi xử lý lời bài hát.');
    }
  }

  private parseAnalysisResponse(responseText: string): IAnalysisResult {
    try {
      return JSON.parse(responseText) as IAnalysisResult;
    } catch {
      const cleanedText = responseText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const jsonStart = cleanedText.indexOf("{");
      const jsonEnd = cleanedText.lastIndexOf("}");

      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        throw new Error("Kết quả phân tích từ AI không đúng cấu trúc yêu cầu.");
      }

      const jsonText = cleanedText.slice(jsonStart, jsonEnd + 1);
      return JSON.parse(jsonText) as IAnalysisResult;
    }
  }

  private buildPrompt(title: string, artist: string, lyrics: string, attempt = 1): string {
    if (lyrics.trim() === "") {
      return `
        Nhiệm vụ: Phân tích sâu sắc bài hát "${title}" của nghệ sĩ "${artist}".
        Bạn là một chuyên gia phê bình âm nhạc quốc tế, nhà ngôn ngữ học, nhà nghiên cứu văn hóa truyền thống Việt Nam đồng thời am hiểu văn hóa Gen Z và phân tích bài hát.

        VÒNG TÌM KIẾM HIỆN TẠI: ${attempt}/${this.MAX_WEB_SEARCH_ATTEMPTS}

        BƯỚC 1 - TÌM VÀ ĐỌC TOÀN BỘ LỜI BÀI HÁT:
        1. Sử dụng Google Search với nhiều truy vấn biến thể:
           - "${title} ${artist} lyrics"
           - "${title} ${artist} lời bài hát"
           - "${title}" "${artist}" "full lyrics"
           - "${title}" "${artist}" site:musixmatch.com
           - "${title}" "${artist}" site:genius.com
           - "${title}" "${artist}" site:zingmp3.vn
           - "${title}" "${artist}" site:nhaccuatui.com
           - "${title}" "${artist}" site:spotify.com
        2. Ưu tiên nguồn theo thứ tự: Musixmatch, Genius, Spotify, Zing MP3, NhacCuaTui, các trang lyrics uy tín khác.
        3. Nếu nguồn đầu không đầy đủ, bắt buộc mở nguồn kế tiếp để đối chiếu cho đến khi có full lyrics.
        4. Sau khi tìm được link, đọc TOÀN BỘ lời bài hát từ trang web.
        5. QUAN TRỌNG: Phải sao chép CHÍNH XÁC toàn bộ lời bài hát từ nguồn, không được tự bịa hoặc thay đổi.

        BƯỚC 2 - PHÂN TÍCH SÂU SẮC LỜI BÀI HÁT:
        HƯỚNG DẪN PHÂN TÍCH THEO TỪNG THỂ LOẠI:
        - Nếu là RAP/HIP-HOP: Hãy bóc tách cực kỳ chi tiết các kỹ thuật Wordplay (chơi chữ), Pun, Slang (ngôn ngữ đường phố), và các Punchline. Giải thích các lớp nghĩa ẩn dụ trong lời Rap.
        - Nếu là POP/BALLAD/INDIE: Tập trung vào luồng cảm xúc, câu chuyện tự sự, tính kết nối giữa giai điệu và ca từ.
        - Nếu là CẢI LƯƠNG/NHẠC TRUYỀN THỐNG: Phân tích các điển tích điển cố, các từ Hán Việt cổ, tính triết lý và nhân văn đặc trưng của văn hóa dân gian Việt Nam.
        - Nếu là NHẠC QUỐC TẾ (US-UK/K-Pop...): Phân tích ý nghĩa trong ngữ cảnh văn hóa của quốc gia đó.

        YÊU CẦU BẮT BUỘC:
        - PHẢI tìm kiếm và đọc lời bài hát từ web trước khi phân tích
        - PHẢI sao chép CHÍNH XÁC toàn bộ lời bài hát vào trường "fullLyrics"
        - Chỉ phân tích dựa trên lời bài hát thực sự đọc được từ trang web
        - KHÔNG ĐƯỢC tự bịa hoặc đoán lời bài hát
        - Nếu không tìm được lời bài hát, trả về null cho fullLyrics

        ⚠️ YÊU CẦU VỀ FORMAT TRẢ VỀ - CỰC KỲ QUAN TRỌNG:
        - Response của bạn PHẢI bắt đầu bằng ký tự '{' và kết thúc bằng ký tự '}'
        - KHÔNG ĐƯỢC có bất kỳ text nào trước dấu '{' đầu tiên
        - KHÔNG ĐƯỢC có bất kỳ text nào sau dấu '}' cuối cùng
        - TUYỆT ĐỐI KHÔNG được bọc JSON trong markdown code blocks như \`\`\`json hoặc \`\`\`
        - KHÔNG được thêm giải thích, comment, hoặc text mô tả
        - Response PHẢI là RAW JSON thuần túy, có thể parse trực tiếp bằng JSON.parse()
        - Đảm bảo JSON hợp lệ: tất cả string phải dùng dấu ngoặc kép, không có trailing comma
        - Tất cả các trường đều phải ngắn gọn, súc tích, đi thẳng vào vấn đề
        
        ✅ ĐÚNG: Response trông như thế này (bắt đầu ngay bằng dấu ngoặc nhọn):
        {
          "fullLyrics": "...",
          "vibe": "..."
        }
        
        ❌ SAI: Không được có text như thế này:
        Here is the analysis:
        \`\`\`json
        {
          "fullLyrics": "..."
        }
        \`\`\`

        YÊU CẦU TRẢ VỀ JSON DUY NHẤT (KHÔNG CÓ DẪN GIẢI NGOÀI JSON):
        {
          "fullLyrics": "TOÀN BỘ lời bài hát đầy đủ, chính xác từ nguồn web. Giữ nguyên format, xuống dòng, và cấu trúc như trên web.",
          "vibe": "1 câu NGẮN GỌN về vibe/cảm xúc chủ đạo (tối đa 3-4 từ, ví dụ: Suy, Chữa lành, ...). Lưu ý: chỉ sử dụng tiếng Việt",
          "overview": "Tóm tắt NGẮN GỌN ý nghĩa cốt lõi nội dung của bài hát (khoảng 1-2 câu ngắn gọn, tối đa 120 từ)",
          "analysis": [
            {
              "section": "Tên đoạn - PHẢI dùng format chuẩn: Intro, Verse 1, Verse 2, Pre-Chorus, Chorus, Post-Chorus, Bridge, Outro, hoặc Hook",
              "lyricsQuote": "Nếu đoạn ngắn (dưới 10 câu): trích dẫn TOÀN BỘ lời của đoạn. Nếu đoạn dài: trích 7 câu QUAN TRỌNG NHẤT làm đại diện",
              "content": "Phân tích ý nghĩa cốt lõi đoạn này (NGẮN GỌN, 4-5 câu, đi thẳng vào ý chính)."
            }
          ],
          "metaphors": [
            {
              "phrase": "Câu hát hoặc cụm từ/từ ngữ ẩn dụ, đặc biệt, đắt giá",
              "meaning": "Giải nghĩa nguồn gốc và ý nghĩa của slang/ẩn dụ đó (NGẮN GỌN, 1-2 câu, đi thẳng vào ý chính)."
            }
          ],
          "coreMessage": "Thông điệp cốt lõi mà nghệ sĩ muốn truyền tải qua bài hát này (1 câu duy nhất, tối đa 100 từ)."
        }

        YÊU CẦU QUAN TRỌNG VỀ TÊN ĐOẠN (section):
        - PHẢI sử dụng tên chuẩn theo cấu trúc bài hát: Intro, Verse 1, Verse 2, Verse 3, Pre-Chorus, Chorus, Post-Chorus, Bridge, Outro, Hook
        - Đánh số các Verse theo thứ tự: Verse 1, Verse 2, Verse 3...
        - Nếu có nhiều Chorus giống nhau, có thể ghi "Chorus" hoặc "Chorus (lặp lại)"
        - KHÔNG được tự đặt tên tùy ý như "Đoạn 1", "Phần mở đầu", v.v.
        - Giữ tên tiếng Anh để thống nhất giữa các bài

        YÊU CẦU VỀ ĐỘ DÀI:
        - Mọi phân tích phải NGẮN GỌN, SÚC TÍCH
        - Đi thẳng vào vấn đề, không dài dòng
        - Mỗi phần content trong analysis: 2-3 câu
        - Mỗi meaning trong metaphors: 1-2 câu
        - coreMessage: 1 câu duy nhất

        LƯU Ý: Mọi nội dung phân tích phải bằng Tiếng Việt. Giọng văn: Khách quan, sâu sắc, hiện đại, ngôn ngữ Việt Nam.
      `
    }

    return `
      Nhiệm vụ:
      Bạn là một chuyên gia phê bình âm nhạc quốc tế, nhà ngôn ngữ học, nhà nghiên cứu văn hóa truyền thống Việt Nam đồng thời am hiểu văn hóa Gen Z và phân tích bài hát.
      Hãy phân tích sâu sắc bài hát "${title}" của nghệ sĩ "${artist}".

      LỜI BÀI HÁT CẦN PHÂN TÍCH:
      ${lyrics}

      HƯỚNG DẪN PHÂN TÍCH THEO TỪNG THỂ LOẠI:
      - Nếu là RAP/HIP-HOP: Hãy bóc tách cực kỳ chi tiết các kỹ thuật Wordplay (chơi chữ), Pun, Slang (ngôn ngữ đường phố), và các Punchline. Giải thích các lớp nghĩa ẩn dụ trong lời Rap.
      - Nếu là POP/BALLAD/INDIE: Tập trung vào luồng cảm xúc, câu chuyện tự sự, tính kết nối giữa giai điệu và ca từ.
      - Nếu là CẢI LƯƠNG/NHẠC TRUYỀN THỐNG: Phân tích các điển tích điển cố, các từ Hán Việt cổ, tính triết lý và nhân văn đặc trưng của văn hóa dân gian Việt Nam.
      - Nếu là NHẠC QUỐC TẾ (US-UK/K-Pop...): Phân tích ý nghĩa trong ngữ cảnh văn hóa của quốc gia đó.

      YÊU CẦU TRẢ VỀ JSON DUY NHẤT (KHÔNG CÓ DẪN GIẢI NGOÀI JSON):
      {
        "fullLyrics": "Nội dung lời bài hát gốc chính xác tôi gửi ở trên đã được định dạng xuống dòng",
        "vibe": "1 câu NGẮN GỌN về vibe/cảm xúc chủ đạo (tối đa 3-4 từ, ví dụ: Suy, Chữa lành, ...). Lưu ý: chỉ sử dụng tiếng Việt",
        "overview": "Tóm tắt NGẮN GỌN ý nghĩa cốt lõi nội dung của bài hát (khoảng 1-2 câu ngắn gọn, tối đa 120 từ)",
        "analysis": [
          {
            "section": "Tên đoạn - PHẢI dùng format chuẩn: Intro, Verse 1, Verse 2, Pre-Chorus, Chorus, Post-Chorus, Bridge, Outro, hoặc Hook",
            "lyricsQuote": "Nếu đoạn ngắn (dưới 10 câu): trích dẫn TOÀN BỘ lời của đoạn. Nếu đoạn dài: trích 7 câu QUAN TRỌNG NHẤT làm đại diện",
            "content": "Phân tích ý nghĩa cốt lõi đoạn này (NGẮN GỌN, 4-5 câu, đi thẳng vào ý chính)."
          }
        ],
        "metaphors": [
          {
            "phrase": "Câu hát hoặc cụm từ/từ ngữ ẩn dụ, đặc biệt, đắt giá",
            "meaning": "Giải nghĩa nguồn gốc và ý nghĩa của slang/ẩn dụ đó (NGẮN GỌN, 1-2 câu, đi thẳng vào ý chính)."
          }
        ],
        "coreMessage": "Thông điệp cốt lõi mà nghệ sĩ muốn truyền tải qua bài hát này (1 câu duy nhất, tối đa 100 từ)."
      }

      YÊU CẦU QUAN TRỌNG VỀ TÊN ĐOẠN (section):
      - PHẢI sử dụng tên chuẩn theo cấu trúc bài hát: Intro, Verse 1, Verse 2, Verse 3, Pre-Chorus, Chorus, Post-Chorus, Bridge, Outro, Hook
      - Đánh số các Verse theo thứ tự: Verse 1, Verse 2, Verse 3...
      - Nếu có nhiều Chorus giống nhau, có thể ghi "Chorus" hoặc "Chorus (lặp lại)"
      - KHÔNG được tự đặt tên tùy ý như "Đoạn 1", "Phần mở đầu", v.v.
      - Giữ tên tiếng Anh để thống nhất giữa các bài

      YÊU CẦU VỀ ĐỘ DÀI:
      - Mọi phân tích phải NGẮN GỌN, SÚC TÍCH
      - Đi thẳng vào vấn đề, không dài dòng
      - Mỗi phần content trong analysis: 2-3 câu
      - Mỗi meaning trong metaphors: 1-2 câu
      - coreMessage: 1 câu duy nhất

      LƯU Ý: Mọi nội dung phân tích phải bằng Tiếng Việt. Giọng văn: Khách quan, sâu sắc, hiện đại, ngôn ngữ Việt Nam.
    `;
  }
}