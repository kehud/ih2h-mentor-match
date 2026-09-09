import { Injectable, inject } from '@angular/core';
import {
  Auth,
  User,
  signInWithEmailAndPassword,
  signOut
} from '@angular/fire/auth';

type KnownRole = 'admin' | 'mentee';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly auth = inject(Auth);
  private knownRole: { uid: string; role: KnownRole } | null = null;

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
    this.knownRole = null;
  }

  rememberRole(uid: string, role: KnownRole): void {
    this.knownRole = { uid, role };
  }

  getKnownRole(uid: string): KnownRole | null {
    return this.knownRole?.uid === uid ? this.knownRole.role : null;
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
