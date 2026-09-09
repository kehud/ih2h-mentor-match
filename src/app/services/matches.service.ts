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

const unavailableAssignment: MentorAssignment = {
  menteeUid: '__unavailable__'
};

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

export class FeedbackActionLimitError extends Error {
  constructor() {
    super('The feedback action limit has been reached.');
    this.name = 'FeedbackActionLimitError';
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
      const unsubscribeAssignments = new Map<string, () => void>();

      const unsubscribeAuth = onAuthStateChanged(auth, user => {
        unsubscribeMatches?.();
        unsubscribeMatches = null;
        unsubscribeAssignments.forEach(unsubscribe => unsubscribe());
        unsubscribeAssignments.clear();

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

        const reconcileAssignmentListeners = () => {
          const mentorKeys = new Set(currentMatches.map(match => match.mentorKey));

          unsubscribeAssignments.forEach((unsubscribe, mentorKey) => {
            if (!mentorKeys.has(mentorKey)) {
              unsubscribe();
              unsubscribeAssignments.delete(mentorKey);
              mentorAssignments.delete(mentorKey);
            }
          });

          mentorKeys.forEach(mentorKey => {
            if (unsubscribeAssignments.has(mentorKey)) {
              return;
            }

            const unsubscribe = onSnapshot(
              doc(db, 'mentorAssignments', mentorKey),
              assignmentSnapshot => {
                mentorAssignments.set(
                  mentorKey,
                  assignmentSnapshot.exists() ? assignmentSnapshot.data() as MentorAssignment : null
                );
                publishAvailableMatches();
              },
              () => {
                // A mentor assigned to somebody else is intentionally not readable
                // by mentees. Treat that denied lookup as unavailable in the UI.
                mentorAssignments.set(mentorKey, unavailableAssignment);
                publishAvailableMatches();
              }
            );

            unsubscribeAssignments.set(mentorKey, unsubscribe);
          });
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

            reconcileAssignmentListeners();
            publishAvailableMatches();
          },
          error => subscriber.error(error)
        );
      });

      return () => {
        unsubscribeMatches?.();
        unsubscribeAssignments.forEach(unsubscribe => unsubscribe());
        unsubscribeAssignments.clear();
        unsubscribeAuth();
      };
    });
  }

  async selectMentor(match: Match): Promise<void> {
    if (!match.id) {
      throw new Error('Match ID is required.');
    }

    const matchId = match.id;
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User is not authenticated.');
    }

    const db = getFirestore();
    const mentorKey = match.mentorKey;
    const matchRef = doc(db, 'matches', matchId);
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
        matchId,
        matchRef,
        assignmentRef,
        menteeRef
      );
    });
  }

  async toggleNotInterested(match: Match): Promise<void> {
    if (!match.id) {
      throw new Error('Match ID is required.');
    }

    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User is not authenticated.');
    }

    const db = getFirestore();
    const matchRef = doc(db, 'matches', match.id);
    const menteeRef = doc(db, 'mentees', user.uid);

    await runTransaction(db, async transaction => {
      const [matchSnapshot, menteeSnapshot] = await Promise.all([
        transaction.get(matchRef),
        transaction.get(menteeRef)
      ]);
      const storedMatch = matchSnapshot.data() as Partial<Match> | undefined;
      const mentee = menteeSnapshot.data() as {
        feedbackActionCount?: unknown;
        selectedMentorKey?: string;
      } | undefined;

      if (!storedMatch || storedMatch.menteeId !== user.uid || !matchSnapshot.exists()) {
        throw new Error('Match does not belong to the authenticated mentee.');
      }

      if (mentee?.selectedMentorKey) {
        throw new MenteeAlreadySelectedError();
      }

      const feedbackActionCount = typeof mentee?.feedbackActionCount === 'number'
        && Number.isInteger(mentee.feedbackActionCount)
        && mentee.feedbackActionCount >= 0
        ? mentee.feedbackActionCount
        : 0;

      if (feedbackActionCount >= 5) {
        throw new FeedbackActionLimitError();
      }

      if (
        storedMatch.decision !== 'pending'
        && storedMatch.decision !== 'passed'
        && storedMatch.decision !== 'liked'
      ) {
        throw new Error('This match decision cannot be changed.');
      }

      transaction.update(matchRef, {
        decision: storedMatch.decision === 'passed' ? 'pending' : 'passed'
      });
      transaction.set(menteeRef, {
        feedbackActionCount: feedbackActionCount + 1
      }, { merge: true });
    });
  }

  private assertSelectionCanBeSaved(
    transaction: Transaction,
    match: Partial<Match> | undefined,
    assignmentExists: boolean,
    mentee: { selectedMentorKey?: string } | undefined,
    menteeUid: string,
    mentorKey: string,
    matchId: string,
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
      selectedMatchId: matchId,
      selectedMentorKey: mentorKey,
      selectedMentorRank: match.rank,
      selectedAt: selectionTimestamp
    }, { merge: true });
    transaction.update(matchRef, { decision: 'selected' });
  }
}
