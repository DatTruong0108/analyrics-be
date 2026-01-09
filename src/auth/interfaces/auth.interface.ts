export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  role: string;
  password?: string;
}

export interface ILoginResult {
  user: IUser;
  accessToken: string;
} 