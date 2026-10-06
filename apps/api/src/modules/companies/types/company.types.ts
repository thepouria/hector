export type CompanyContext = {
  companyId: string;
  companyMemberId: string;
};

export type CompanyView = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  timezone: string;
  status: string;
};

export type MemberRoleView = {
  id: string;
  key: string;
  name: string;
};

export type MemberUserView = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type MemberView = {
  id: string;
  status: string;
  joinedAt: Date;
  user: MemberUserView;
  roles: MemberRoleView[];
};
