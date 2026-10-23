/* System Package */
import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';

/* Application Package */
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './services/favorites.service';
import { IFavoritesRepository } from './repositories/favorites.repository';
import { FavoritesRepositoryImpl } from './repositories/favorites.repository.impl';

@Module({
  imports: [
    PrismaModule,
  ],
  controllers: [
    FavoritesController
  ],
  providers: [
    FavoritesService,
    {
      provide: IFavoritesRepository,
      useClass: FavoritesRepositoryImpl,
    },
  ],
  exports: [
    // AnalysisController reads it to put `isFavorited` on the analyze response.
    FavoritesService,
  ],
})
export class FavoritesModule {}
