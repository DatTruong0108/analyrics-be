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
      Bạn là một chuyên gia phê bình âm nhạc quốc tế, nhà ngôn ngữ học và nhà nghiên cứu văn hóa truyền thống Việt Nam.
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
        "vibe": "Mô tả không khí bài hát (vd: Phẫn nộ, cay đắng, tự tôn)",
        "overview": "Tóm tắt ngắn gọn ý nghĩa cốt lõi của bài hát (khoảng 3-5 câu)",
        "analysis": [
          {
            "section": "Tên đoạn (vd: Verse 1, Chorus, Vọng cổ...)",
            "lyricsQuote": "Trích đoạn lời tiêu biểu của đoạn đó",
            "content": "Phân tích lớp nghĩa sâu xa, Slang, hoặc kỹ thuật sử dụng trong đoạn này"
          }
        ],
        "metaphors": [
          {
            "phrase": "Cụm từ ẩn dụ hoặc từ ngữ đặc biệt",
            "meaning": "Giải thích chi tiết nguồn gốc và ý nghĩa"
          }
        ],
        "coreMessage": "Thông điệp chính mà nghệ sĩ muốn truyền tải qua bài hát này"
      }

      LƯU Ý: Mọi nội dung phân tích phải bằng Tiếng Việt.
    `;
  }
}