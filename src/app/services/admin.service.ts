import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  query,
  where
} from '@angular/fire/firestore';

import {
  AdminDashboard,
  AdminMentor,
  AdminMentorRow,
  AdminMentee,
  AdminMenteeRow,
  MentorAssignment
} from '../models/admin.model';

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
