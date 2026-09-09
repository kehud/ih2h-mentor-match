export interface Mentee {
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
  selectedMatchId?: string;
  selectedMentorKey?: string;
  selectedMentorRank?: number;
  selectedAt?: unknown;
  feedbackActionCount?: number;
}
