import { Mentee } from './mentee.model';

export interface AdminMentee extends Mentee {
  id: string;
}

export interface MentorAssignment {
  id: string;
  menteeUid: string;
  assignedAt?: unknown;
}

export interface AdminMentor {
  id: string;
  mentorFullName?: string;
  mentorEmail?: string;
}

export interface AdminMenteeRow extends AdminMentee {
  mentorName: string | null;
  mentorEmail: string | null;
  lastLoginAt?: unknown;
  selectionStatus: 'selected' | 'waiting';
}

export interface AdminMentorRow extends AdminMentor {
  assignmentStatus: 'available' | 'assigned';
  assignedMenteeName: string | null;
  assignedMenteeEmail: string | null;
  assignedAt?: unknown;
}

export interface AdminDashboard {
  totalMentees: number;
  selectedCount: number;
  waitingCount: number;
  assignedMentorsCount: number;
  selectionPercentage: number;
  neverLoggedInCount: number;
  rows: AdminMenteeRow[];
  mentorRows: AdminMentorRow[];
  recentSelections: AdminMenteeRow[];
}
