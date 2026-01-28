/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* System Package */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Result, Ok, Err } from "oxide.ts";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

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
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })
  }

  async analyzeLyrics(title: string, artist: string, lyrics: string): Promise<Result<IAnalysisResult, string>> {
    try {
      const prompt = this.buildPrompt(title, artist, lyrics);

      const result = await this.model.generateContent(prompt);
      const responseText = result.response?.text();

      if (!responseText) {
        return Err('AI không trả về kết quả phân tích.');
      }

      const parsedData = JSON.parse(responseText) as IAnalysisResult;

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

  private buildPrompt(title: string, artist: string, lyrics: string): string {
    return `
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
        "fullLyrics": "Nội dung lời bài hát gốc đã được định dạng xuống dòng",
        "vibe": "1 câu NGẮN GỌN về vibe/cảm xúc chủ đạo (tối đa 3-5 từ, ví dụ: Suy, Chữa lành, Flex...)",
        "overview": "Tóm tắt ngắn gọn ý nghĩa cốt lõi nội dung của bài hát (khoảng 1-2 câu ngắn gọn, tối đa 120 từ)",
        "analysis": [
          {
            "section": "Tên đoạn - PHẢI dùng format chuẩn: Intro, Verse 1, Verse 2, Pre-Chorus, Chorus, Post-Chorus, Bridge, Outro, hoặc Hook",
            "lyricsQuote": "Nếu đoạn ngắn (dưới 10 câu): trích dẫn TOÀN BỘ lời của đoạn. Nếu đoạn dài: trích 7 câu QUAN TRỌNG NHẤT làm đại diện",
            "content": "Phân tích lớp nghĩa sâu xa, Slang, hoặc kỹ thuật sử dụng trong đoạn này (NGẮN GỌN, 4-5 câu, đi thẳng vào ý chính)."
          }
        ],
        "metaphors": [
          {
            "phrase": "Cụm từ ẩn dụ hoặc từ ngữ đặc biệt, đắt giá",
            "meaning": "Giải thích chi tiết nguồn gốc và ý nghĩa (NGẮN GỌN, 1-2 câu, đi thẳng vào ý chính)."
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

      LƯU Ý: Mọi nội dung phân tích phải bằng Tiếng Việt. Giọng văn: Khách quan, sâu sắc, hiện đại, ngôn ngữ Việt Nam.
    `;
  }
}