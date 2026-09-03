import { Injectable, inject } from '@angular/core';
import {
  Auth,
  User,
  signInWithEmailAndPassword,
  signOut
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly auth = inject(Auth);

  async login(email: string, password: string): Promise<User> {
    const credential = await signInWithEmailAndPassword(
      this.auth,
      email,
      password
    );

    return credential.user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  get isLoggedIn(): boolean {
    return !!this.auth.currentUser;
  }
}
