import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { COMPANY_ID_HEADER, REQUIRE_COMPANY_KEY } from '../../../common/constants';

/**
 * Marks a route/controller as requiring validated company context via X-Company-Id.
 */
export const RequireCompany = () => SetMetadata(REQUIRE_COMPANY_KEY, true);

export const ApiCompanyHeader = () =>
  applyDecorators(
    ApiHeader({
      name: COMPANY_ID_HEADER,
      description: 'Validated company context UUID. Must match an ACTIVE membership.',
      required: true,
    }),
  );
