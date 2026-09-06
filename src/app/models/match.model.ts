import type { AppLanguage } from '../services/language.service';

export type LocalizedField<T> = Record<AppLanguage, T>;
export type LegacyLocalizedField<T> = LocalizedField<T> | T;

export interface Match {
  id?: string;

  menteeId: string;

  rank: number;
  matchScore: number;

  mentorName: string;
  mentorBio: LegacyLocalizedField<string>;
  mentorProfessionalBackground: LegacyLocalizedField<string>;

  mentorInterests: LegacyLocalizedField<string[]>;
  reasons: LegacyLocalizedField<string[]>;
  matchedAreas: LegacyLocalizedField<string[]>;

  decision: 'pending' | 'liked' | 'passed' | 'selected';

  generatedAt: unknown;
}
