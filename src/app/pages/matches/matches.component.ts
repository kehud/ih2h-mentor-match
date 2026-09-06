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
import { MatchesService } from '../../services/matches.service';
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
  private readonly decisionOverrides = new Map<string, Match['decision']>();

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
  readonly swipeProgressDots = [0, 1, 2, 3, 4];

  updatingMatchId: string | null = null;
  currentMatchIndex = 0;
  expandedMatchId: string | null = null;
  isMatchesLoading = true;
  isLoggingOut = false;
  private touchStart: { x: number; y: number } | null = null;
  private suppressDecisionClick = false;
  private loadingStartedAt = Date.now();
  private loadingTimeout: ReturnType<typeof setTimeout> | null = null;
  private swipeFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  swipeTransition: 'outgoing-left' | 'outgoing-right' | 'incoming-left' | 'incoming-right' | null = null;

  constructor() {
    this.resetMobileScrollPosition();

    combineLatest([this.matchesState$, this.mentee$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.finishLoading());

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

  getMentorFirstName(mentorName: string): string {
    return mentorName.trim().split(/\s+/)[0] ?? '';
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

  getDecision(match: Match): Match['decision'] {
    return match.id ? (this.decisionOverrides.get(match.id) ?? match.decision) : match.decision;
  }

  isProfileExpanded(match: Match): boolean {
    return this.expandedMatchId === this.getProfileKey(match);
  }

  toggleProfile(match: Match): void {
    const profileKey = this.getProfileKey(match);
    this.expandedMatchId = this.expandedMatchId === profileKey ? null : profileKey;
  }

  private getProfileKey(match: Match): string {
    return match.id ?? match.mentorName;
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

  handleDecisionClick(
    event: MouseEvent,
    match: Match,
    decision: Match['decision']
  ): void {
    if (this.suppressDecisionClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    void this.setDecision(match, decision);
  }

  async setDecision(
    match: Match,
    decision: Match['decision']
  ): Promise<void> {
    if (!match.id) {
      return;
    }

    this.decisionOverrides.set(match.id, decision);
    this.updatingMatchId = match.id;

    try {
      await this.matchesService.updateDecision(
        match.id,
        decision
      );
    } catch (error) {
      this.decisionOverrides.delete(match.id);
      console.error('Failed to update match decision:', error);
    } finally {
      this.updatingMatchId = null;
    }
  }

  hasSelectedMatch(matches: Match[]): boolean {
    return matches.some(match => this.getDecision(match) === 'selected');
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
