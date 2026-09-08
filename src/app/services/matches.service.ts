import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Transaction,
  where
} from 'firebase/firestore';

import { Match } from '../models/match.model';

interface MentorAssignment {
  menteeUid: string;
}

export class MentorUnavailableError extends Error {
  constructor() {
    super('This mentor is no longer available.');
    this.name = 'MentorUnavailableError';
  }
}

export class MenteeAlreadySelectedError extends Error {
  constructor() {
    super('A final mentor selection has already been saved.');
    this.name = 'MenteeAlreadySelectedError';
  }
}

@Injectable({
  providedIn: 'root'
})
export class MatchesService {

  getMyMatches(): Observable<Match[]> {
    return new Observable<Match[]>(subscriber => {
      const auth = getAuth();
      const db = getFirestore();

      let unsubscribeMatches: (() => void) | null = null;
      let unsubscribeAssignments: Array<() => void> = [];

      const unsubscribeAuth = onAuthStateChanged(auth, user => {
        unsubscribeMatches?.();
        unsubscribeMatches = null;
        unsubscribeAssignments.forEach(unsubscribe => unsubscribe());
        unsubscribeAssignments = [];

        if (!user) {
          subscriber.next([]);
          return;
        }

        const matchesQuery = query(
          collection(db, 'matches'),
          where('menteeId', '==', user.uid)
        );

        const mentorAssignments = new Map<string, MentorAssignment | null>();
        let currentMatches: Match[] = [];

        const publishAvailableMatches = () => {
          subscriber.next(
            currentMatches.filter(match => {
              const assignment = mentorAssignments.get(match.mentorKey);

              return !assignment || assignment.menteeUid === user.uid;
            })
          );
        };

        unsubscribeMatches = onSnapshot(
          matchesQuery,
          snapshot => {
            currentMatches = snapshot.docs
              .map(document => ({
                id: document.id,
                ...document.data()
              } as Match))
              .sort((a, b) => a.rank - b.rank);

            unsubscribeAssignments.forEach(unsubscribe => unsubscribe());
            unsubscribeAssignments = [...new Set(currentMatches.map(match => match.mentorKey))].map(mentorKey =>
              onSnapshot(
                doc(db, 'mentorAssignments', mentorKey),
                assignmentSnapshot => {
                  mentorAssignments.set(
                    mentorKey,
                    assignmentSnapshot.exists() ? assignmentSnapshot.data() as MentorAssignment : null
                  );
                  publishAvailableMatches();
                },
                error => subscriber.error(error)
              )
            );

            publishAvailableMatches();
          },
          error => subscriber.error(error)
        );
      });

      return () => {
        unsubscribeMatches?.();
        unsubscribeAssignments.forEach(unsubscribe => unsubscribe());
        unsubscribeAuth();
      };
    });
  }

  async selectMentor(match: Match): Promise<void> {
    if (!match.id) {
      throw new Error('Match ID is required.');
    }

    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User is not authenticated.');
    }

    const db = getFirestore();
    const mentorKey = match.mentorKey;
    const matchRef = doc(db, 'matches', match.id);
    const assignmentRef = doc(db, 'mentorAssignments', mentorKey);
    const menteeRef = doc(db, 'mentees', user.uid);

    await runTransaction(db, async transaction => {
      const [matchSnapshot, assignmentSnapshot, menteeSnapshot] = await Promise.all([
        transaction.get(matchRef),
        transaction.get(assignmentRef),
        transaction.get(menteeRef)
      ]);

      this.assertSelectionCanBeSaved(
        transaction,
        matchSnapshot.data() as Partial<Match> | undefined,
        assignmentSnapshot.exists(),
        menteeSnapshot.data() as { selectedMentorKey?: string } | undefined,
        user.uid,
        mentorKey,
        matchRef,
        assignmentRef,
        menteeRef
      );
    });
  }

  private assertSelectionCanBeSaved(
    transaction: Transaction,
    match: Partial<Match> | undefined,
    assignmentExists: boolean,
    mentee: { selectedMentorKey?: string } | undefined,
    menteeUid: string,
    mentorKey: string,
    matchRef: ReturnType<typeof doc>,
    assignmentRef: ReturnType<typeof doc>,
    menteeRef: ReturnType<typeof doc>
  ): void {
    if (!match || match.menteeId !== menteeUid || !match.mentorKey) {
      throw new Error('Match does not belong to the authenticated mentee.');
    }

    if (match.mentorKey !== mentorKey) {
      throw new Error('Match mentor has changed. Please refresh and try again.');
    }

    if (mentee?.selectedMentorKey) {
      throw new MenteeAlreadySelectedError();
    }

    if (assignmentExists) {
      throw new MentorUnavailableError();
    }

    const selectionTimestamp = serverTimestamp();

    transaction.set(assignmentRef, {
      menteeUid,
      assignedAt: selectionTimestamp
    });

    transaction.set(menteeRef, {
      selectedMentorKey: mentorKey,
      selectedAt: selectionTimestamp
    }, { merge: true });
    transaction.update(matchRef, { decision: 'selected' });
  }
}
