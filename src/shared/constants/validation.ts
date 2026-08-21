/* System Package */
import { ValidationPipeOptions } from '@nestjs/common';

/**
 * The single definition of how request validation behaves.
 *
 * main.ts installs this as the global pipe, and the controller tests build
 * their app with the same object — so a change here shows up in the tests
 * instead of silently altering production validation only.
 *
 * `forbidNonWhitelisted` rejects unknown properties outright. Note that this
 * applies to any handler taking a whole DTO (`@Query() dto`, `@Body() dto`);
 * handlers reading primitives (`@Query('q') q: string`) bypass the pipe.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
