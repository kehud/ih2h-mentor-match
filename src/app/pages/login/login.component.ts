import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../services/auth.service';

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

  email = '';
  password = '';

  loading = false;
  errorMessage = '';
  private loadingStartedAt = 0;

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage = 'Email and password are required.';
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
          this.errorMessage = 'Invalid email or password.';
          break;

        case 'auth/invalid-email':
          this.errorMessage = 'Invalid email address.';
          break;

        case 'auth/too-many-requests':
          this.errorMessage = 'Too many attempts. Try again later.';
          break;

        default:
          this.errorMessage = 'Login failed.';
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
