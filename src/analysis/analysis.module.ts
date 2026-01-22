/* System Package */
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';

/* Application Package */
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './services/analysis.service';
import { SpotifyService } from './services/spotify.service';
import { LyricsService } from './services/lyrics.service';
import { AIService } from './services/ai.service';
import { IAnalysisRepository } from './repositories/analysis.repository';
import { AnalysisRepositoryImpl } from './repositories/analysis.repository.impl';
import { SearchService } from './services/search.service';

@Module({
  imports: [
    PrismaModule, 
  ],
  controllers: [
    AnalysisController
  ],
  providers: [
    AnalysisService,
    SpotifyService,
    SearchService,
    LyricsService,
    AIService,

    {
      provide: IAnalysisRepository,
      useClass: AnalysisRepositoryImpl,
    },
  ],
  exports: [
    AnalysisService,
  ],
})
export class AnalysisModule {}