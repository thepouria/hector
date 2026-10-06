export const OWNER_ROLE_KEY = 'OWNER';

export const COMPANY_ERROR_MESSAGES = {
  COMPANY_CONTEXT_REQUIRED: 'A company context is required for this request.',
  COMPANY_NOT_FOUND: 'Company not found.',
  COMPANY_UNAVAILABLE: 'Company is unavailable.',
  MEMBER_NOT_FOUND: 'Member not found.',
  MEMBERSHIP_ALREADY_EXISTS: 'Membership already exists for this user.',
  MEMBERSHIP_SUSPENDED: 'Membership is suspended.',
  MEMBERSHIP_REMOVED: 'Membership has been removed.',
  USER_NOT_FOUND: 'User not found.',
  OWNER_REQUIRED: 'Owner access is required for this action.',
  LAST_OWNER_REQUIRED: 'Cannot leave the company without at least one active owner.',
  ROLE_NOT_FOUND: 'One or more roles were not found.',
  INVALID_COMPANY_ROLE: 'One or more roles do not belong to the current company.',
  INVALID_TIMEZONE: 'Timezone is invalid.',
} as const;

export const MEMBER_SORT_FIELDS = ['joinedAt', 'firstName', 'lastName'] as const;
export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];
