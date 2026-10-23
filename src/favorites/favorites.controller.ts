// /* System Package */
import { Controller, Get, Post, Delete, Param, Query, Res, HttpStatus, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { ApiBearerAuth, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";

// /* Application Package */
import { FavoritesService } from "./services/favorites.service";
import { FavoriteSongParamDto, FavoriteStateResponse, FavoritesQueryDto, FavoritesResponse } from "./favorites.dto";
import { AtGuard } from "src/auth/guards/at.guard";
import { GetCurrentUserId } from "src/shared/decorators/getCurrentUserId.decorator";

const SYSTEM_ERROR_MESSAGE = 'Hệ thống bị lỗi, vui lòng thử lại sau.';
const UNAUTHORIZED_MESSAGE = 'Bạn cần đăng nhập để sử dụng danh sách yêu thích.';

/*
 * Every route is per-user. AtGuard is the permissive guard, so each handler
 * answers 401 for a guest itself — same pattern as /analysis/history.
 */
@ApiTags('Favorites')
@ApiCookieAuth()
@ApiBearerAuth()
@UseGuards(AtGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) { }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách bài hát yêu thích của người dùng hiện tại (Phân trang)' })
  @ApiOkResponse({ description: 'Lấy danh sách yêu thích thành công', type: FavoritesResponse })
  @ApiUnauthorizedResponse({ description: 'Chưa đăng nhập hoặc phiên đã hết hạn' })
  async getFavorites(
    @GetCurrentUserId() userId: string | null,
    @Query() query: FavoritesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!userId) {
        this.sendUnauthorized(res);
        return;
      }

      const result = await this.favoritesService.getFavorites(userId, query.limit, query.offset);

      if (result.isErr()) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: result.unwrapErr(),
        });
        return;
      }

      const response: FavoritesResponse = {
        statusCode: HttpStatus.OK,
        message: 'Lấy danh sách yêu thích thành công',
        data: result.unwrap(),
      };

      res.status(HttpStatus.OK).json(response);
    } catch (error) {
      console.error('Get Favorites Error:', error);
      this.sendSystemError(res);
    }
  }

  /*
   * The heart's state for one song. The song page is rendered without the
   * user's session, so the browser asks for this after the page loads.
   */
  @Get(':songId')
  @ApiOperation({ summary: 'Kiểm tra bài hát có trong danh sách yêu thích hay không' })
  @ApiOkResponse({ description: 'Trạng thái yêu thích hiện tại', type: FavoriteStateResponse })
  @ApiUnauthorizedResponse({ description: 'Chưa đăng nhập hoặc phiên đã hết hạn' })
  async getFavoriteState(
    @GetCurrentUserId() userId: string | null,
    @Param() params: FavoriteSongParamDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!userId) {
        this.sendUnauthorized(res);
        return;
      }

      const result = await this.favoritesService.getFavoriteState(userId, params.songId);

      if (result.isErr()) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: result.unwrapErr(),
        });
        return;
      }

      const response: FavoriteStateResponse = {
        statusCode: HttpStatus.OK,
        message: 'Lấy trạng thái yêu thích thành công',
        data: { songId: params.songId, isFavorited: result.unwrap() },
      };

      res.status(HttpStatus.OK).json(response);
    } catch (error) {
      console.error('Get Favorite State Error:', error);
      this.sendSystemError(res);
    }
  }

  /* Idempotent: favouriting a song that is already favourited is still a 200. */
  @Post(':songId')
  @ApiOperation({ summary: 'Thêm bài hát vào danh sách yêu thích' })
  @ApiOkResponse({ description: 'Bài hát đã nằm trong danh sách yêu thích', type: FavoriteStateResponse })
  @ApiUnauthorizedResponse({ description: 'Chưa đăng nhập hoặc phiên đã hết hạn' })
  @ApiNotFoundResponse({ description: 'Bài hát không tồn tại (chưa từng được phân tích)' })
  async addFavorite(
    @GetCurrentUserId() userId: string | null,
    @Param() params: FavoriteSongParamDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!userId) {
        this.sendUnauthorized(res);
        return;
      }

      const result = await this.favoritesService.addFavorite(userId, params.songId);

      if (result.isErr()) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: result.unwrapErr(),
        });
        return;
      }

      if (!result.unwrap()) {
        res.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Bài hát không tồn tại.',
        });
        return;
      }

      const response: FavoriteStateResponse = {
        statusCode: HttpStatus.OK,
        message: 'Đã thêm bài hát vào yêu thích',
        data: { songId: params.songId, isFavorited: true },
      };

      res.status(HttpStatus.OK).json(response);
    } catch (error) {
      console.error('Add Favorite Error:', error);
      this.sendSystemError(res);
    }
  }

  /* Idempotent: removing a song that is not favourited is still a 200. */
  @Delete(':songId')
  @ApiOperation({ summary: 'Xoá bài hát khỏi danh sách yêu thích' })
  @ApiOkResponse({ description: 'Bài hát không còn trong danh sách yêu thích', type: FavoriteStateResponse })
  @ApiUnauthorizedResponse({ description: 'Chưa đăng nhập hoặc phiên đã hết hạn' })
  async removeFavorite(
    @GetCurrentUserId() userId: string | null,
    @Param() params: FavoriteSongParamDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!userId) {
        this.sendUnauthorized(res);
        return;
      }

      const result = await this.favoritesService.removeFavorite(userId, params.songId);

      if (result.isErr()) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: result.unwrapErr(),
        });
        return;
      }

      const response: FavoriteStateResponse = {
        statusCode: HttpStatus.OK,
        message: 'Đã xoá bài hát khỏi yêu thích',
        data: { songId: params.songId, isFavorited: false },
      };

      res.status(HttpStatus.OK).json(response);
    } catch (error) {
      console.error('Remove Favorite Error:', error);
      this.sendSystemError(res);
    }
  }

  private sendUnauthorized(res: Response): void {
    res.status(HttpStatus.UNAUTHORIZED).json({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: UNAUTHORIZED_MESSAGE,
    });
  }

  private sendSystemError(res: Response): void {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: SYSTEM_ERROR_MESSAGE,
    });
  }
}
