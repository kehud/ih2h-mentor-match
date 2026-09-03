export interface Match {
  id?: string;

  menteeId: string;

  rank: number;
  matchScore: number;

  mentorName: string;
  mentorBio: string;
  mentorProfessionalBackground: string;

  mentorInterests: string[];
  reasons: string[];
  matchedAreas: string[];

  decision: 'pending' | 'liked' | 'passed' | 'selected';

  generatedAt: unknown;
}
