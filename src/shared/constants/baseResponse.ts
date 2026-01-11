import { ApiProperty } from "@nestjs/swagger";

export class BaseResponse {
  @ApiProperty({ example: 200, description: 'Status code' })
  statusCode: number;

  @ApiProperty({ example: 'Success', description: 'Status message' })
  message: string;
}