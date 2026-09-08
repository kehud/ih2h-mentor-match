import { Component, DestroyRef, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  map,
  of,
  shareReplay,
  switchMap
} from 'rxjs';

import { Match } from '../../models/match.model';
import type { LegacyLocalizedField } from '../../models/match.model';
import { Mentee } from '../../models/mentee.model';
import {
  MatchesService,
  MenteeAlreadySelectedError,
  MentorUnavailableError
} from '../../services/matches.service';
import { MenteeService } from '../../services/mentee.service';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';

@Component({
  selector: 'app-matches',
  standalone: true,
  imports: [AsyncPipe, RouterLink],
  templateUrl: './matches.component.html',
  styleUrl: './matches.component.scss'
})
export class MatchesComponent {
  private readonly matchesService = inject(MatchesService);
  private readonly menteeService = inject(MenteeService);
  private readonly authService = inject(AuthService);
  readonly languageService = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshMatches$ = new BehaviorSubject<void>(undefined);

  readonly matchesState$ = this.refreshMatches$.pipe(
    switchMap(() => this.matchesService.getMyMatches().pipe(
      map(matches => ({ matches, hasError: false })),
      catchError(() => of({ matches: [] as Match[], hasError: true }))
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly mentee$ = this.menteeService.getCurrentMentee().pipe(
    catchError(() => of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly viewState$ = combineLatest([this.matchesState$, this.mentee$]).pipe(
    map(([matchesState, mentee]) => ({ ...matchesState, mentee })),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  currentMatchIndex = 0;
  expandedMatchId: string | null = null;
  isMatchesLoading = true;
  isLoggingOut = false;
  isFinalSelectionInProgress = false;
  pendingMentorSelection: Match | null = null;
  private finalSelectionMentorKey: string | null = null;
  selectionMessage: 'selectionSaved' | 'unavailable' | 'alreadySelected' | 'error' | null = null;
  private touchStart: { x: number; y: number } | null = null;
  private suppressDecisionClick = false;
  private loadingStartedAt = Date.now();
  private loadingTimeout: ReturnType<typeof setTimeout> | null = null;
  private swipeFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private visibleMatchIds: string[] = [];
  swipeTransition: 'outgoing-left' | 'outgoing-right' | 'incoming-left' | 'incoming-right' | null = null;

  constructor() {
    this.resetMobileScrollPosition();

    this.viewState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(viewState => {
        this.reconcileVisibleMatchIndex(viewState.matches);
        this.finishLoading();
      });

    this.destroyRef.onDestroy(() => {
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
      }

      if (this.swipeFeedbackTimeout) {
        clearTimeout(this.swipeFeedbackTimeout);
      }
    });
  }

  getActiveMatch(matches: Match[]): Match | null {
    return matches[this.getActiveMatchIndex(matches)] ?? null;
  }

  private reconcileVisibleMatchIndex(matches: Match[]): void {
    const currentMatchId = this.visibleMatchIds[this.getActiveMatchIndexFromLength(this.visibleMatchIds.length)];

    if (currentMatchId) {
      const currentMatchIndex = matches.findIndex(match => this.getMatchKey(match) === currentMatchId);

      if (currentMatchIndex >= 0) {
        this.currentMatchIndex = currentMatchIndex;
      } else {
        this.currentMatchIndex = this.getActiveMatchIndex(matches);
      }
    } else {
      this.currentMatchIndex = this.getActiveMatchIndex(matches);
    }

    this.visibleMatchIds = matches.map(match => this.getMatchKey(match));
  }

  private getActiveMatchIndexFromLength(length: number): number {
    return length ? Math.min(this.currentMatchIndex, length - 1) : 0;
  }

  private getMatchKey(match: Match): string {
    return match.id ?? match.mentorKey;
  }

  private finishLoading(): void {
    if (!this.isMatchesLoading) {
      return;
    }

    const remainingDuration = Math.max(0, 2500 - (Date.now() - this.loadingStartedAt));

    this.loadingTimeout = setTimeout(() => {
      this.isMatchesLoading = false;
      this.resetMobileScrollPosition();
    }, remainingDuration);
  }

  retryMatches(): void {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }

    this.loadingStartedAt = Date.now();
    this.isMatchesLoading = true;
    this.resetMobileScrollPosition();
    this.refreshMatches$.next();
  }

  getActiveMatchIndex(matches: Match[]): number {
    if (!matches.length) {
      return 0;
    }

    return Math.min(this.currentMatchIndex, matches.length - 1);
  }

  showPreviousMatch(matches: Match[]): void {
    const activeIndex = this.getActiveMatchIndex(matches);
    this.expandedMatchId = null;
    this.currentMatchIndex = activeIndex === 0 ? matches.length - 1 : activeIndex - 1;
  }

  showNextMatch(matches: Match[]): void {
    const activeIndex = this.getActiveMatchIndex(matches);
    this.expandedMatchId = null;
    this.currentMatchIndex = activeIndex === matches.length - 1 ? 0 : activeIndex + 1;
  }

  showMatch(index: number): void {
    this.expandedMatchId = null;
    this.currentMatchIndex = index;
  }

  getMentorFirstName(mentorDisplayName: string): string {
    return mentorDisplayName.trim().split(/\s+/)[0] ?? '';
  }

  getPickLabel(rank: number): string {
    return rank === 1
      ? this.languageService.t('topPick')
      : this.languageService.t('pick', { rank });
  }

  getConnectionAreas(match: Match): string[] {
    return [
      ...this.getLocalizedArray(match.matchedAreas),
      ...this.getLocalizedArray(match.mentorInterests)
    ];
  }

  getLocalizedText(value: LegacyLocalizedField<string>): string {
    return typeof value === 'string'
      ? value
      : value[this.languageService.language()] ?? value.en ?? value.he ?? '';
  }

  getLocalizedArray(value: LegacyLocalizedField<string[]>): string[] {
    return Array.isArray(value)
      ? value
      : value[this.languageService.language()] ?? value.en ?? value.he ?? [];
  }

  isFinalSelectionLocked(mentee: Mentee | null): boolean {
    return Boolean(mentee?.selectedMentorKey ?? this.finalSelectionMentorKey);
  }

  isSelectedMentor(match: Match, mentee: Mentee | null): boolean {
    return (mentee?.selectedMentorKey ?? this.finalSelectionMentorKey) === match.mentorKey;
  }

  isSelectionError(): boolean {
    return this.selectionMessage === 'unavailable'
      || this.selectionMessage === 'alreadySelected'
      || this.selectionMessage === 'error';
  }

  dismissSelectionMessage(): void {
    this.selectionMessage = null;
  }

  isProfileExpanded(match: Match): boolean {
    return this.expandedMatchId === this.getProfileKey(match);
  }

  toggleProfile(match: Match): void {
    const profileKey = this.getProfileKey(match);
    this.expandedMatchId = this.expandedMatchId === profileKey ? null : profileKey;
  }

  private getProfileKey(match: Match): string {
    return this.getMatchKey(match);
  }

  onMatchTouchStart(event: TouchEvent): void {
    const touch = event.touches.item(0);

    if (!touch) {
      return;
    }

    this.touchStart = { x: touch.clientX, y: touch.clientY };
  }

  onMatchTouchEnd(event: TouchEvent, matches: Match[]): void {
    const touch = event.changedTouches.item(0);
    const touchStart = this.touchStart;
    this.touchStart = null;

    if (!touch || !touchStart) {
      return;
    }

    const horizontalDistance = touch.clientX - touchStart.x;
    const verticalDistance = touch.clientY - touchStart.y;

    if (
      this.swipeTransition ||
      Math.abs(horizontalDistance) < 56 ||
      Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
    ) {
      return;
    }

    event.preventDefault();
    this.suppressDecisionClick = true;
    setTimeout(() => (this.suppressDecisionClick = false), 350);

    if (horizontalDistance < 0) {
      this.playSwipeTransition(matches, 'left');
    } else {
      this.playSwipeTransition(matches, 'right');
    }
  }

  private playSwipeTransition(matches: Match[], direction: 'left' | 'right'): void {
    if (this.prefersReducedMotion()) {
      direction === 'left' ? this.showNextMatch(matches) : this.showPreviousMatch(matches);
      return;
    }

    if (this.swipeFeedbackTimeout) {
      clearTimeout(this.swipeFeedbackTimeout);
    }

    const activeIndex = this.getActiveMatchIndex(matches);
    const incomingIndex = direction === 'left'
      ? (activeIndex === matches.length - 1 ? 0 : activeIndex + 1)
      : (activeIndex === 0 ? matches.length - 1 : activeIndex - 1);

    this.expandedMatchId = null;
    this.swipeTransition = `outgoing-${direction}`;
    this.swipeFeedbackTimeout = setTimeout(() => {
      this.currentMatchIndex = incomingIndex;
      this.swipeTransition = `incoming-${direction}`;
      this.swipeFeedbackTimeout = setTimeout(() => {
        this.swipeTransition = null;
        this.swipeFeedbackTimeout = null;
      }, 110);
    }, 110);
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private resetMobileScrollPosition(): void {
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 720px)').matches) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  chooseMentor(event: MouseEvent, match: Match, mentee: Mentee | null): void {
    if (
      this.suppressDecisionClick ||
      !match.id ||
      this.isFinalSelectionInProgress ||
      this.pendingMentorSelection ||
      this.isFinalSelectionLocked(mentee)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.pendingMentorSelection = match;
  }

  cancelMentorSelection(): void {
    if (!this.isFinalSelectionInProgress) {
      this.pendingMentorSelection = null;
    }
  }

  confirmMentorSelection(): void {
    const match = this.pendingMentorSelection;

    if (!match || this.isFinalSelectionInProgress) {
      return;
    }

    this.isFinalSelectionInProgress = true;
    void this.saveFinalSelection(match);
  }

  private async saveFinalSelection(match: Match): Promise<void> {
    if (!match.id) {
      return;
    }

    this.selectionMessage = null;
    try {
      await this.matchesService.selectMentor(match);
      this.finalSelectionMentorKey = match.mentorKey;
      this.selectionMessage = 'selectionSaved';
    } catch (error) {
      if (error instanceof MentorUnavailableError) {
        this.selectionMessage = 'unavailable';
        this.refreshMatches$.next();
      } else if (error instanceof MenteeAlreadySelectedError) {
        this.selectionMessage = 'alreadySelected';
      } else {
        this.selectionMessage = 'error';
        console.error('Failed to save final mentor selection:', error);
      }
    } finally {
      this.isFinalSelectionInProgress = false;
      this.pendingMentorSelection = null;
    }
  }

  async logout(): Promise<void> {
    if (this.isLoggingOut) {
      return;
    }

    this.isLoggingOut = true;

    try {
      await new Promise<void>(resolve => setTimeout(resolve, 2000));
      await this.authService.logout();
      await this.router.navigateByUrl('/');
    } finally {
      this.isLoggingOut = false;
    }
  }
}
