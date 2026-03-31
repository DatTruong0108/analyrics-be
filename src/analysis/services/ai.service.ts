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
      const prompt = this.buildPrompt(title, artist, normalizedLyrics);
      const request: GenerateContentRequest & { tools?: Array<Record<string, unknown>> } = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ]
      };

      if (shouldUseWebSearch) {
        request.tools = [
          {
            googleSearch: {}
          }
        ];
      } else {
        request.generationConfig = {
          responseMimeType: "application/json",
        };
      }

      const result = await this.model.generateContent(request);
      const responseText = result.response?.text();

      if (!responseText) {
        return Err('AI không trả về kết quả phân tích.');
      }

      const parsedData = this.parseAnalysisResponse(responseText) as IAnalysisResult;

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

  private buildPrompt(title: string, artist: string, lyrics: string): string {
    if (lyrics.trim() === "") {
      return `
        Nhiệm vụ: Phân tích sâu sắc bài hát "${title}" của nghệ sĩ "${artist}".
        Bạn là một chuyên gia phê bình âm nhạc quốc tế, nhà ngôn ngữ học, nhà nghiên cứu văn hóa truyền thống Việt Nam đồng thời am hiểu văn hóa Gen Z và phân tích bài hát.

        BƯỚC 1 - TÌM VÀ ĐỌC TOÀN BỘ LỜI BÀI HÁT:
        1. Sử dụng công cụ Google Search để tìm lời bài hát CHÍNH THỨC của bài "${title}" của nghệ sĩ "${artist}".
        2. Tìm trên các nguồn uy tín: Zing Mp3, Nhaccuatui, Musixmatch hoặc các trang lời bài hát khác.
        3. Sau khi tìm được link, sử dụng URL Context tool để đọc TOÀN BỘ lời bài hát từ trang web
        4. QUAN TRỌNG: Phải sao chép CHÍNH XÁC toàn bộ lời bài hát từ nguồn, không được tự bịa hoặc thay đổi

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