import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  where
} from 'firebase/firestore';

import { Match } from '../models/match.model';

@Injectable({
  providedIn: 'root'
})
export class MatchesService {

  getMyMatches(): Observable<Match[]> {
    return new Observable<Match[]>(subscriber => {
      const auth = getAuth();
      const db = getFirestore();

      let unsubscribeMatches: (() => void) | null = null;

      const unsubscribeAuth = onAuthStateChanged(auth, user => {
        unsubscribeMatches?.();
        unsubscribeMatches = null;

        if (!user) {
          subscriber.next([]);
          return;
        }

        const matchesQuery = query(
          collection(db, 'matches'),
          where('menteeId', '==', user.uid)
        );

        unsubscribeMatches = onSnapshot(
          matchesQuery,
          snapshot => {
            const matches = snapshot.docs
              .map(document => ({
                id: document.id,
                ...document.data()
              } as Match))
              .sort((a, b) => a.rank - b.rank);

            subscriber.next(matches);
          },
          error => subscriber.error(error)
        );
      });

      return () => {
        unsubscribeMatches?.();
        unsubscribeAuth();
      };
    });
  }

  async updateDecision(
    matchId: string,
    decision: Match['decision']
  ): Promise<void> {
    const auth = getAuth();

    if (!auth.currentUser) {
      throw new Error('User is not authenticated.');
    }

    const db = getFirestore();

    await updateDoc(
      doc(db, 'matches', matchId),
      { decision }
    );
  }
}
