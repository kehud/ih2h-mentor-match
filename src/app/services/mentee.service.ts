import { Injectable, inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  docData
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { Mentee } from '../models/mentee.model';

@Injectable({
  providedIn: 'root'
})
export class MenteeService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);

  getCurrentMentee(): Observable<Mentee | null> {
    return authState(this.auth).pipe(
      switchMap(user => {
        if (!user) {
          return of(null);
        }

        const menteeRef = doc(
          this.firestore,
          `mentees/${user.uid}`
        );

        return docData(menteeRef) as Observable<Mentee>;
      })
    );
  }
}
