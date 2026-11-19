export type Role = 'admin' | 'organizer' | 'customer';

/** The signed-in account, as `/auth/refresh`, `/auth/me` and every sign-in route return it. */
export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: string;
  avatarUrl: string | null;
  cityId: string | null;
  emailVerified: boolean;
  createdAt: string;
  organizer?: { id: string; displayName: string; slug: string; status: string } | null;
}

export interface SessionResponse {
  user: SessionUser;
  accessToken: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}
