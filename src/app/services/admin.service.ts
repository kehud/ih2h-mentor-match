import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from '@angular/fire/firestore';

import {
  AdminDashboard,
  AdminMentor,
  AdminMentorRow,
  AdminMentee,
  AdminMenteeRow,
  AdminTopMatch,
  MentorAssignment
} from '../models/admin.model';
import { Match } from '../models/match.model';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private readonly firestore = inject(Firestore);

  async getDashboard(): Promise<AdminDashboard> {
    const [menteesSnapshot, assignmentsSnapshot, mentorsSnapshot, usersSnapshot] = await Promise.all([
      getDocs(collection(this.firestore, 'mentees')),
      getDocs(collection(this.firestore, 'mentorAssignments')),
      getDocs(collection(this.firestore, 'adminMentors')),
      getDocs(query(collection(this.firestore, 'users'), where('role', 'in', ['admin', 'mentee'])))
    ]);
    const usersById = new Map(usersSnapshot.docs.map(document => [document.id, document.data()]));
    const adminUserIds = new Set(
      usersSnapshot.docs
        .filter(document => document.data()['role'] === 'admin')
        .map(document => document.id)
    );
    const mentees = menteesSnapshot.docs
      .map(document => ({ id: document.id, ...document.data() } as AdminMentee))
      .filter(mentee => !adminUserIds.has(mentee.id));
    const assignments = assignmentsSnapshot.docs
      .map(document => ({ id: document.id, ...document.data() } as MentorAssignment))
      .filter(assignment => !adminUserIds.has(assignment.menteeUid));
    const mentors = mentorsSnapshot.docs
      .map(document => ({ id: document.id, ...document.data() } as AdminMentor));
    const mentorsByKey = new Map(mentors.map(mentor => [mentor.id, mentor]));
    const menteesById = new Map(mentees.map(mentee => [mentee.id, mentee]));
    const assignmentsByMentorKey = new Map(assignments.map(assignment => [assignment.id, assignment]));
    const selectedCount = mentees.filter(mentee => mentee.selectedMentorKey !== undefined).length;
    const rows = [...mentees]
      .sort((a, b) => this.getMenteeName(a).localeCompare(this.getMenteeName(b)))
      .map((mentee): AdminMenteeRow => {
        const mentor = mentee.selectedMentorKey
          ? mentorsByKey.get(mentee.selectedMentorKey)
          : undefined;

        return {
          ...mentee,
          mentorName: mentor?.mentorFullName ?? null,
          mentorEmail: mentor?.mentorEmail ?? null,
          lastLoginAt: usersById.get(mentee.id)?.['lastLoginAt'],
          selectionStatus: mentee.selectedMentorKey !== undefined ? 'selected' : 'waiting'
        };
      });
    const mentorRows = [...mentors]
      .sort((a, b) => (a.mentorFullName ?? '').localeCompare(b.mentorFullName ?? ''))
      .map((mentor): AdminMentorRow => {
        const assignment = assignmentsByMentorKey.get(mentor.id);
        const assignedMentee = assignment ? menteesById.get(assignment.menteeUid) : undefined;

        return {
          ...mentor,
          assignmentStatus: assignment ? 'assigned' : 'available',
          assignedMenteeUid: assignment?.menteeUid ?? null,
          assignedMenteeName: assignedMentee ? this.getMenteeName(assignedMentee) : null,
          assignedMenteeEmail: assignedMentee?.email ?? null,
          assignedAt: assignment?.assignedAt
        };
      });
    const recentSelections = rows
      .filter(row => row.selectionStatus === 'selected')
      .sort((a, b) => this.getTimestampMillis(b.selectedAt) - this.getTimestampMillis(a.selectedAt))
      .slice(0, 5);

    return {
      totalMentees: mentees.length,
      selectedCount,
      waitingCount: mentees.length - selectedCount,
      assignedMentorsCount: assignments.length,
      selectionPercentage: mentees.length ? Math.round((selectedCount / mentees.length) * 100) : 0,
      neverLoggedInCount: rows.filter(row => !row.lastLoginAt).length,
      rows,
      mentorRows,
      recentSelections
    };
  }

  async getTopMatches(
    menteeUid: string,
    mentorRows: ReadonlyArray<AdminMentorRow>
  ): Promise<{
    topMatches: AdminTopMatch[];
    matchDetailsById: Map<string, Pick<Match, 'reasons' | 'matchedAreas'>>;
  }> {
    const matchesSnapshot = await getDocs(query(
      collection(this.firestore, 'matches'),
      where('menteeId', '==', menteeUid)
    ));
    const mentorsByKey = new Map(mentorRows.map(mentor => [mentor.id, mentor]));

    const matches = matchesSnapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      } as Pick<Match, 'mentorKey' | 'rank' | 'matchScore' | 'reasons' | 'matchedAreas' | 'decision'> & { id: string }))
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 5);

    return {
      topMatches: matches.map((match): AdminTopMatch => {
        const mentor = mentorsByKey.get(match.mentorKey);
        const assignedMenteeUid = mentor?.assignedMenteeUid;

        return {
          id: match.id,
          mentorKey: match.mentorKey,
          rank: match.rank,
          mentorFullName: mentor?.mentorFullName ?? null,
          mentorEmail: mentor?.mentorEmail ?? null,
          matchScore: match.matchScore,
          decision: match.decision,
          isSelected: match.decision === 'selected',
          isUnavailable: Boolean(assignedMenteeUid && assignedMenteeUid !== menteeUid)
        };
      }),
      matchDetailsById: new Map(matches.map(match => [match.id, {
        reasons: match.reasons,
        matchedAreas: match.matchedAreas
      }]))
    };
  }

  async updateTopMatchStatus(
    menteeUid: string,
    match: Pick<AdminTopMatch, 'id' | 'mentorKey' | 'rank'>,
    status: 'available' | 'notInterested' | 'selected'
  ): Promise<void> {
    const matchRef = doc(this.firestore, 'matches', match.id);

    if (status !== 'selected') {
      await updateDoc(matchRef, { decision: status === 'available' ? 'pending' : 'passed' });
      return;
    }

    const menteeRef = doc(this.firestore, 'mentees', menteeUid);
    const assignmentRef = doc(this.firestore, 'mentorAssignments', match.mentorKey);

    await runTransaction(this.firestore, async transaction => {
      const [matchSnapshot, menteeSnapshot, assignmentSnapshot] = await Promise.all([
        transaction.get(matchRef),
        transaction.get(menteeRef),
        transaction.get(assignmentRef)
      ]);
      const storedMatch = matchSnapshot.data() as Pick<Match, 'menteeId' | 'mentorKey'> | undefined;
      const mentee = menteeSnapshot.data() as Pick<AdminMentee, 'selectedMatchId' | 'selectedMentorKey'> | undefined;

      if (!storedMatch || storedMatch.menteeId !== menteeUid || storedMatch.mentorKey !== match.mentorKey) {
        throw new Error('The match no longer belongs to this mentee.');
      }

      if (mentee?.selectedMentorKey) {
        throw new Error('This mentee already has a selected mentor.');
      }

      if (assignmentSnapshot.exists()) {
        throw new Error('This mentor is already assigned.');
      }

      const selectedAt = serverTimestamp();
      transaction.set(assignmentRef, { menteeUid, assignedAt: selectedAt });
      transaction.update(menteeRef, {
        selectedMatchId: match.id,
        selectedMentorKey: match.mentorKey,
        selectedMentorRank: match.rank,
        selectedAt
      });
      transaction.update(matchRef, { decision: 'selected' });
    });
  }

  async clearTopMatchSelection(
    menteeUid: string,
    match: Pick<AdminTopMatch, 'id' | 'mentorKey'>
  ): Promise<void> {
    const matchRef = doc(this.firestore, 'matches', match.id);
    const menteeRef = doc(this.firestore, 'mentees', menteeUid);
    const assignmentRef = doc(this.firestore, 'mentorAssignments', match.mentorKey);

    await runTransaction(this.firestore, async transaction => {
      const [matchSnapshot, menteeSnapshot, assignmentSnapshot] = await Promise.all([
        transaction.get(matchRef),
        transaction.get(menteeRef),
        transaction.get(assignmentRef)
      ]);
      const storedMatch = matchSnapshot.data() as Pick<Match, 'menteeId' | 'mentorKey' | 'decision'> | undefined;
      const mentee = menteeSnapshot.data() as Pick<AdminMentee, 'selectedMatchId' | 'selectedMentorKey'> | undefined;
      const assignment = assignmentSnapshot.data() as Pick<MentorAssignment, 'menteeUid'> | undefined;

      if (
        !storedMatch
        || storedMatch.menteeId !== menteeUid
        || storedMatch.mentorKey !== match.mentorKey
        || storedMatch.decision !== 'selected'
        || mentee?.selectedMatchId !== match.id
        || mentee?.selectedMentorKey !== match.mentorKey
        || assignment?.menteeUid !== menteeUid
      ) {
        throw new Error('The current selection has changed. Refresh and try again.');
      }

      transaction.delete(assignmentRef);
      transaction.update(menteeRef, {
        selectedMatchId: deleteField(),
        selectedMentorKey: deleteField(),
        selectedMentorRank: deleteField(),
        selectedAt: deleteField()
      });
      transaction.update(matchRef, { decision: 'pending' });
    });
  }

  getMenteeName(mentee: AdminMentee): string {
    return `${mentee.firstName ?? ''} ${mentee.lastName ?? ''}`.trim() || mentee.email;
  }

  private getTimestampMillis(value: unknown): number {
    if (!value || typeof value !== 'object' || !('toDate' in value)) {
      return 0;
    }

    const date = (value as { toDate: () => Date }).toDate();

    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
}
