import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.component')
        .then(m => m.LoginComponent)
  },
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
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin.component')
        .then(m => m.AdminComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
