/* eslint-disable @typescript-eslint/no-unused-vars */
/* System Package */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { Result, Ok, Err } from "oxide.ts";
import { Prisma } from "@prisma/client";

/* Application Package */ 
import { IAuthRepository } from "./auth.repository";
import { IUser } from "../interfaces/auth.interface";
import { RegisterDto } from "../auth.dto";

@Injectable()
export class AuthRepositoryImpl implements IAuthRepository {
  private readonly SYSTEM_ERROR = 'Hệ thống bị lỗi, vui lòng thử lại sau.';

  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<Result<IUser | null, string>> {
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      return Ok(user as IUser | null);
    } catch (error) {
      return Err(this.SYSTEM_ERROR);
    }
  }

  async findById(id: string): Promise<Result<IUser | null, string>> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id } });
      return Ok(user as IUser | null);
    } catch (error) {
      return Err(this.SYSTEM_ERROR);
    }
  }

  async createUser(data: RegisterDto, hashedPassword: string): Promise<Result<IUser, string>> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: data.email,
          name: data.name,
          password: hashedPassword,
        },
      });
      return Ok(user as IUser);
    } catch (error) {
      return Err('Không thể tạo tài khoản. ' + this.SYSTEM_ERROR);
    }
  }

  async updateName(id: string, name: string): Promise<Result<IUser | null, string>> {
    try {
      const user = await this.prisma.user.update({ where: { id }, data: { name } });
      return Ok(user as IUser);
    } catch (error) {
      // P2025: the row to update does not exist — a deleted user, not a fault.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return Ok(null);
      }
      return Err('Không thể cập nhật tên. ' + this.SYSTEM_ERROR);
    }
  }
}
