import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { catchError, map, Observable, of, switchMap, take } from 'rxjs';

import { AppUser } from '../models/app-user.model';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const firestore = inject(Firestore);
  const authService = inject(AuthService);
  const router = inject(Router);

  return authState(auth).pipe(
    take(1),
    switchMap(user => {
      if (!user) {
        return of(router.parseUrl('/'));
      }

      const knownRole = authService.getKnownRole(user.uid);

      if (knownRole !== null) {
        return of(knownRole === 'admin' ? true : router.parseUrl('/matches'));
      }

      return (docData(doc(firestore, `users/${user.uid}`)) as Observable<AppUser | undefined>).pipe(
        take(1),
        map(appUser => appUser?.role === 'admin' ? true : router.parseUrl('/matches')),
        catchError(() => of(router.parseUrl('/matches')))
      );
    })
  );
};
