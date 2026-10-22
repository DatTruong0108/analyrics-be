/* System Package */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/* Application Package */
import { MAX_USER_NAME_LENGTH, UpdateProfileDto } from './auth.dto';
import { VALIDATION_PIPE_OPTIONS } from 'src/shared/constants/validation';

/** Runs the body through the same transform + validation the global pipe does. */
async function check(body: Record<string, string | number | null>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, {
    whitelist: VALIDATION_PIPE_OPTIONS.whitelist,
    forbidNonWhitelisted: VALIDATION_PIPE_OPTIONS.forbidNonWhitelisted,
  });
  return { dto, errors };
}

describe('UpdateProfileDto', () => {
  it('accepts a normal name and trims surrounding whitespace', async () => {
    const { dto, errors } = await check({ name: '  Trương Tấn Đạt  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Trương Tấn Đạt');
  });

  it('rejects an empty name', async () => {
    const { errors } = await check({ name: '' });
    expect(errors).toHaveLength(1);
  });

  it('rejects a whitespace-only name, since it is trimmed before validation', async () => {
    const { errors } = await check({ name: '    ' });
    expect(errors).toHaveLength(1);
  });

  it(`accepts exactly ${MAX_USER_NAME_LENGTH} characters and rejects one more`, async () => {
    const atLimit = await check({ name: 'a'.repeat(MAX_USER_NAME_LENGTH) });
    const overLimit = await check({ name: 'a'.repeat(MAX_USER_NAME_LENGTH + 1) });

    expect(atLimit.errors).toHaveLength(0);
    expect(overLimit.errors).toHaveLength(1);
  });

  it('measures the limit after trimming, so padding does not count', async () => {
    const padded = `  ${'a'.repeat(MAX_USER_NAME_LENGTH)}  `;
    const { errors } = await check({ name: padded });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-string name', async () => {
    const { errors } = await check({ name: 123 });
    expect(errors).toHaveLength(1);
  });

  it('rejects a missing name', async () => {
    const { errors } = await check({});
    expect(errors).toHaveLength(1);
  });

  it('rejects unknown properties such as an attempted email change', async () => {
    const { errors } = await check({ name: 'Đạt', email: 'x@example.com' });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
