import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.component')
        .then(m => m.LoginComponent)
  },
  {
    path: 'matches',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/matches/matches.component')
        .then(m => m.MatchesComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
