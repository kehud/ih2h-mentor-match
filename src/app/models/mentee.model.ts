export interface Mentee {
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
  selectedMentorKey?: string;
  selectedMentorRank?: number;
  selectedAt?: unknown;
}
