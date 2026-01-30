/*
  Warnings:

  - Added the required column `updatedAt` to the `UserHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserHistory" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
