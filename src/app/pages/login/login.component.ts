import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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
      await this.authService.login(
        this.email.trim(),
        this.password
      );

      await this.waitForBrandedTransition();
      await this.router.navigateByUrl('/matches');
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
}
