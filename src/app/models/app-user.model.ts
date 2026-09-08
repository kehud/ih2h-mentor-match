export interface AppUser {
  email: string;
  role: 'admin' | 'mentee';
  lastLoginAt?: unknown;
}
