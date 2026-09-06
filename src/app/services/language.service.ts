import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, effect, inject, signal } from '@angular/core';

export type AppLanguage = 'en' | 'he';

type TranslationKey = keyof typeof translations.en;

const LANGUAGE_STORAGE_KEY = 'ih2h-mentor-match-language';

const translations = {
  en: {
    signInToViewMatches: 'Sign in to view your mentor matches',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    signingYouIn: 'Signing you in…',
    emailAndPasswordRequired: 'Email and password are required.',
    invalidEmailOrPassword: 'Invalid email or password.',
    invalidEmailAddress: 'Invalid email address.',
    tooManyAttempts: 'Too many attempts. Try again later.',
    loginFailed: 'Login failed.',
    logout: 'Logout',
    couldNotLoadMatches: 'We couldn’t load your mentor matches.',
    pleaseTryAgain: 'Please try again.',
    tryAgain: 'Try again',
    yourMentorMatches: 'Your mentor matches',
    matchesIntro: 'We found {count} thoughtful mentor recommendations for you.',
    matchesIntroSecondLine: 'Take your time and choose what feels right.',
    mentorMatchPosition: 'Mentor match {current} of {total}',
    topPick: 'Top pick',
    pick: '#{rank} pick',
    match: 'match',
    of: 'of',
    aboutMentor: 'About {name}',
    professionalBackground: 'Professional background',
    whyGoodFit: 'Why this may be a good fit for you',
    areasOfConnection: 'Areas of connection',
    showLess: 'Show less',
    viewFullProfile: 'View full profile',
    passed: 'Passed ✓',
    notRightFit: 'Not the right fit',
    interestedSelected: 'Interested ✓',
    interested: 'Interested',
    selected: 'Selected ✓',
    likeToConnect: "I'd like to connect",
    choiceNote: 'You can review all matches before making your final choice.',
    matchNavigation: 'Match navigation',
    mentorMatchNavigation: 'Mentor match navigation',
    previousMentorMatch: 'Previous mentor match',
    nextMentorMatch: 'Next mentor match',
    showMentorMatch: 'Show mentor match {number}',
    matchesNotReady: 'Your mentor matches aren’t ready yet.',
    preparingMatches: 'Preparing your mentor matches…',
    signingYouOut: 'Signing you out…',
    languageSwitcher: 'Language',
    english: 'EN',
    hebrew: 'עברית'
  },
  he: {
    signInToViewMatches: 'התחברו כדי לצפות בהתאמות המנטורים שלכם',
    email: 'אימייל',
    password: 'סיסמה',
    signIn: 'התחברות',
    signingIn: 'מתחברים...',
    signingYouIn: 'מחברים אותך…',
    emailAndPasswordRequired: 'יש להזין אימייל וסיסמה.',
    invalidEmailOrPassword: 'האימייל או הסיסמה אינם נכונים.',
    invalidEmailAddress: 'כתובת האימייל אינה תקינה.',
    tooManyAttempts: 'בוצעו יותר מדי ניסיונות. נסו שוב מאוחר יותר.',
    loginFailed: 'ההתחברות נכשלה.',
    logout: 'התנתקות',
    couldNotLoadMatches: 'לא הצלחנו לטעון את התאמות המנטורים שלך.',
    pleaseTryAgain: 'נסו שוב.',
    tryAgain: 'נסו שוב',
    yourMentorMatches: 'התאמות המנטורים שלך',
    matchesIntro: 'מצאנו עבורך {count} המלצות מתאימות למנטורים.',
    matchesIntroSecondLine: 'קחו את הזמן ובחרו את מה שמרגיש נכון.',
    mentorMatchPosition: 'התאמת מנטור {current} מתוך {total}',
    topPick: 'ההתאמה המובילה',
    pick: 'התאמה #{rank}',
    match: 'התאמה',
    of: 'מתוך',
    aboutMentor: 'קצת על {name}',
    professionalBackground: 'רקע מקצועי',
    whyGoodFit: 'למה זו עשויה להיות התאמה טובה עבורך',
    areasOfConnection: 'תחומי חיבור',
    showLess: 'הצג פחות',
    viewFullProfile: 'הצג פרופיל מלא',
    passed: 'לא מתאים ✓',
    notRightFit: 'לא מתאים לי',
    interestedSelected: 'מעוניין/ת ✓',
    interested: 'מעוניין/ת',
    selected: 'נבחר/ה ✓',
    likeToConnect: 'אשמח להתחבר',
    choiceNote: 'אפשר לעבור על כל ההתאמות לפני קבלת ההחלטה הסופית.',
    matchNavigation: 'ניווט בין התאמות',
    mentorMatchNavigation: 'ניווט בין התאמות מנטורים',
    previousMentorMatch: 'התאמת המנטור הקודמת',
    nextMentorMatch: 'התאמת המנטור הבאה',
    showMentorMatch: 'הצגת התאמת מנטור {number}',
    matchesNotReady: 'התאמות המנטורים שלך עדיין אינן מוכנות.',
    preparingMatches: 'מכינים את התאמות המנטורים שלך…',
    signingYouOut: 'מנתקים אותך…',
    languageSwitcher: 'שפה',
    english: 'EN',
    hebrew: 'עברית'
  }
} as const;

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly selectedLanguage = signal<AppLanguage>(this.getInitialLanguage());

  readonly language: Signal<AppLanguage> = this.selectedLanguage.asReadonly();

  constructor() {
    effect(() => {
      const language = this.language();
      this.document.documentElement.lang = language;
      this.document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
    });
  }

  setLanguage(language: AppLanguage): void {
    this.selectedLanguage.set(language);

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Language detection still works when storage is unavailable.
    }
  }

  t(key: TranslationKey, params: Record<string, string | number> = {}): string {
    return Object.entries(params).reduce<string>(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      translations[this.language()][key]
    );
  }

  private getInitialLanguage(): AppLanguage {
    try {
      const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

      if (storedLanguage === 'en' || storedLanguage === 'he') {
        return storedLanguage;
      }
    } catch {
      // Use the browser's current language when local storage is unavailable.
    }

    const browserLanguage = typeof navigator === 'undefined'
      ? ''
      : (navigator.languages?.[0] ?? navigator.language ?? '');

    return browserLanguage.toLowerCase().startsWith('he') ? 'he' : 'en';
  }
}
