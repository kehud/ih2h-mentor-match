import { Mentee } from './mentee.model';
import type { Match } from './match.model';

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

export interface AdminTopMatch {
  id: string;
  mentorKey: string;
  rank: number;
  mentorFullName: string | null;
  mentorEmail: string | null;
  matchScore: number;
  decision: Match['decision'];
  isSelected: boolean;
  isUnavailable: boolean;
}

export interface AdminMentorRow extends AdminMentor {
  assignmentStatus: 'available' | 'assigned';
  assignedMenteeUid: string | null;
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
