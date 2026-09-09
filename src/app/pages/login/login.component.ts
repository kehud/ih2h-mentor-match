import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Firestore, doc, getDoc, serverTimestamp, updateDoc } from '@angular/fire/firestore';

import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly router = inject(Router);
  readonly languageService = inject(LanguageService);

  email = '';
  password = '';

  loading = false;
  errorMessage = '';
  private loadingStartedAt = 0;

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage = this.languageService.t('emailAndPasswordRequired');
      return;
    }

    this.loading = true;
    this.loadingStartedAt = Date.now();
    this.errorMessage = '';

    try {
      const user = await this.authService.login(
        this.email.trim(),
        this.password
      );

      await this.recordLastLogin(user.uid);
      await this.waitForBrandedTransition();
      await this.router.navigateByUrl(await this.getPostLoginRoute(user.uid));
    } catch (error: any) {
      console.error('Login failed:', error);

      switch (error?.code) {
        case 'auth/invalid-credential':
          this.errorMessage = this.languageService.t('invalidEmailOrPassword');
          break;

        case 'auth/invalid-email':
          this.errorMessage = this.languageService.t('invalidEmailAddress');
          break;

        case 'auth/too-many-requests':
          this.errorMessage = this.languageService.t('tooManyAttempts');
          break;

        default:
          this.errorMessage = this.languageService.t('loginFailed');
      }
    } finally {
      this.loading = false;
    }
  }

  private async waitForBrandedTransition(): Promise<void> {
    const remainingDuration = Math.max(0, 2000 - (Date.now() - this.loadingStartedAt));

    if (remainingDuration) {
      await new Promise<void>(resolve => setTimeout(resolve, remainingDuration));
    }
  }

  private async getPostLoginRoute(uid: string): Promise<string> {
    try {
      const userSnapshot = await getDoc(doc(this.firestore, `users/${uid}`));
      const role = userSnapshot.data()?.['role'];

      if (role === 'admin' || role === 'mentee') {
        this.authService.rememberRole(uid, role);
      }

      return role === 'admin' ? '/admin' : '/matches';
    } catch {
      return '/matches';
    }
  }

  private async recordLastLogin(uid: string): Promise<void> {
    await updateDoc(doc(this.firestore, `users/${uid}`), {
      lastLoginAt: serverTimestamp()
    });
  }
}
