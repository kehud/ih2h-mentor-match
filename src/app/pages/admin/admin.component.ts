import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import {
  AdminDashboard,
  AdminMentee,
  AdminMenteeRow,
  AdminMentorRow,
  AdminTopMatch
} from '../../models/admin.model';
import type { LegacyLocalizedField, Match } from '../../models/match.model';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';
import { LanguageService } from '../../services/language.service';

type MenteeSortKey = 'name' | 'status' | 'lastLoginAt' | 'selectedAt' | 'selectedRank';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly languageService = inject(LanguageService);

  dashboard: AdminDashboard | null = null;
  activeView: 'mentees' | 'mentors' = 'mentees';
  searchTerm = '';
  selectedFilter: 'all' | 'waiting' | 'selected' = 'all';
  mentorSearchTerm = '';
  mentorFilter: 'all' | 'available' | 'assigned' = 'all';
  menteeSortKey: MenteeSortKey = 'name';
  menteeSortDirection: SortDirection = 'asc';
  copiedMentorEmail: string | null = null;
  isExporting = false;
  lastUpdated: Date | null = null;
  isLoading = true;
  loadFailed = false;
  expandedTop5MenteeId: string | null = null;
  selectedTop5Match: AdminTopMatch | null = null;
  openingTop5MenteeId: string | null = null;
  closingTop5MenteeId: string | null = null;
  updatingTop5MatchId: string | null = null;
  top5StatusError: string | null = null;
  private readonly topMatchesByMenteeId = new Map<string, AdminTopMatch[]>();
  private readonly topMatchDetailsById = new Map<string, Pick<Match, 'reasons' | 'matchedAreas'>>();
  private readonly loadingTop5MenteeIds = new Set<string>();
  private readonly top5LoadErrors = new Set<string>();
  private top5CacheVersion = 0;
  private readonly top5AnimationDurationMs = 480;
  private top5OpenTimer: ReturnType<typeof setTimeout> | null = null;
  private top5CloseTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.refresh();
  }

  getMenteeName(mentee: AdminMentee): string {
    return this.adminService.getMenteeName(mentee);
  }

  formatSelectedAt(value: unknown): string {
    const date = this.getDate(value);

    if (!date) {
      return '—';
    }

    return date.toLocaleString();
  }

  formatLastLogin(value: unknown): string {
    return value ? this.formatSelectedAt(value) : 'Never logged in';
  }

  get filteredRows(): AdminMenteeRow[] {
    if (!this.dashboard) {
      return [];
    }

    const searchTerm = this.searchTerm.trim().toLocaleLowerCase();

    const rows = this.dashboard.rows.filter(row => {
      const matchesFilter = this.selectedFilter === 'all'
        || row.selectionStatus === this.selectedFilter;
      const searchableText = [
        this.getMenteeName(row),
        row.email,
        row.mentorName,
        row.mentorEmail
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();

      return matchesFilter && (!searchTerm || searchableText.includes(searchTerm));
    });

    return rows.sort((left, right) => this.compareMenteeRows(left, right));
  }

  setFilter(filter: 'all' | 'waiting' | 'selected'): void {
    this.selectedFilter = filter;
  }

  get filteredMentorRows(): AdminMentorRow[] {
    if (!this.dashboard) {
      return [];
    }

    const searchTerm = this.mentorSearchTerm.trim().toLocaleLowerCase();

    return this.dashboard.mentorRows.filter(mentor => {
      const matchesFilter = this.mentorFilter === 'all'
        || mentor.assignmentStatus === this.mentorFilter;
      const searchableText = [
        mentor.mentorFullName,
        mentor.mentorEmail,
        mentor.assignedMenteeName,
        mentor.assignedMenteeEmail
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();

      return matchesFilter && (!searchTerm || searchableText.includes(searchTerm));
    });
  }

  setMentorFilter(filter: 'all' | 'available' | 'assigned'): void {
    this.mentorFilter = filter;
  }

  toggleMenteeSort(sortKey: MenteeSortKey): void {
    if (this.menteeSortKey === sortKey) {
      this.menteeSortDirection = this.menteeSortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.menteeSortKey = sortKey;
    this.menteeSortDirection = 'asc';
  }

  sortIndicator(sortKey: MenteeSortKey): string {
    if (this.menteeSortKey !== sortKey) {
      return '↕';
    }

    return this.menteeSortDirection === 'asc' ? '↑' : '↓';
  }

  async copyMentorEmail(email: string | null): Promise<void> {
    if (!email || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(email);
    this.copiedMentorEmail = email;
    setTimeout(() => {
      if (this.copiedMentorEmail === email) {
        this.copiedMentorEmail = null;
      }
    }, 1600);
  }

  async exportWorkbook(): Promise<void> {
    if (!this.dashboard) {
      return;
    }

    this.isExporting = true;

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const menteesSheet = XLSX.utils.aoa_to_sheet([
        ['Mentee', 'Mentee email', 'Status', 'Selected mentor', 'Mentor email', 'Selected rank', 'Selected at', 'Last login'],
        ...this.filteredRows.map(row => [
          this.getMenteeName(row),
          row.email,
          row.selectionStatus,
          row.mentorName ?? '',
          row.mentorEmail ?? '',
          row.selectionStatus === 'selected' ? row.selectedMentorRank ?? '' : '',
          this.getDate(row.selectedAt) ?? '',
          this.getDate(row.lastLoginAt) ?? 'Never logged in'
        ])
      ]);
      const mentorsSheet = XLSX.utils.aoa_to_sheet([
        ['Mentor', 'Email', 'Status', 'Assigned mentee', 'Assigned mentee email', 'Assigned at'],
        ...this.filteredMentorRows.map(mentor => [
          mentor.mentorFullName ?? '',
          mentor.mentorEmail ?? '',
          mentor.assignmentStatus,
          mentor.assignedMenteeName ?? '',
          mentor.assignedMenteeEmail ?? '',
          this.getDate(mentor.assignedAt) ?? ''
        ])
      ]);
      const recentSelectionsSheet = XLSX.utils.aoa_to_sheet([
        ['Mentee', 'Mentee email', 'Mentor', 'Mentor email', 'Selected rank', 'Selected at'],
        ...this.dashboard.recentSelections.map(selection => [
          this.getMenteeName(selection),
          selection.email,
          selection.mentorName ?? '',
          selection.mentorEmail ?? '',
          selection.selectedMentorRank ?? '',
          this.getDate(selection.selectedAt) ?? ''
        ])
      ]);

      this.configureExportSheet(menteesSheet, [22, 28, 12, 24, 28, 15, 22, 22]);
      this.configureExportSheet(mentorsSheet, [28, 28, 12, 24, 28, 22]);
      this.configureExportSheet(recentSelectionsSheet, [22, 28, 24, 28, 15, 22]);
      XLSX.utils.book_append_sheet(workbook, menteesSheet, 'Mentees');
      XLSX.utils.book_append_sheet(workbook, mentorsSheet, 'Mentors');
      XLSX.utils.book_append_sheet(workbook, recentSelectionsSheet, 'Recent Selections');
      XLSX.writeFile(workbook, 'mentor-match-admin.xlsx', { compression: true });
    } finally {
      this.isExporting = false;
    }
  }

  async refresh(): Promise<void> {
    this.isLoading = true;
    this.loadFailed = false;
    this.clearTop5Cache();
    this.expandedTop5MenteeId = null;

    try {
      this.dashboard = await this.adminService.getDashboard();
      this.lastUpdated = new Date();
    } catch {
      this.loadFailed = true;
    } finally {
      this.isLoading = false;
    }
  }

  formatLastUpdated(): string {
    return this.lastUpdated ? this.lastUpdated.toLocaleString() : 'Not loaded yet';
  }

  getTopMatchStatus(match: AdminTopMatch): 'available' | 'notInterested' | 'selected' | 'unavailable' {
    if (match.isUnavailable) {
      return 'unavailable';
    }

    if (match.decision === 'passed') {
      return 'notInterested';
    }

    return match.decision === 'selected' ? 'selected' : 'available';
  }

  getTopMatchStatusLabel(match: AdminTopMatch): string {
    switch (this.getTopMatchStatus(match)) {
      case 'notInterested':
        return 'Not interested';
      case 'selected':
        return 'Selected';
      case 'unavailable':
        return 'Unavailable';
      default:
        return 'Available';
    }
  }

  isTopMatchStatusUpdating(match: AdminTopMatch): boolean {
    return this.updatingTop5MatchId === match.id;
  }

  async updateTopMatchStatus(menteeUid: string, match: AdminTopMatch, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const nextStatus = select.value as 'available' | 'notInterested' | 'selected';
    const currentStatus = this.getTopMatchStatus(match);

    if (nextStatus === currentStatus) {
      return;
    }

    if (currentStatus === 'selected' && nextStatus !== 'available') {
      select.value = currentStatus;
      return;
    }

    if (
      currentStatus === 'selected'
      && !window.confirm('Change this selected mentor back to Available? This will remove the mentor assignment.')
    ) {
      select.value = currentStatus;
      return;
    }

    this.updatingTop5MatchId = match.id;
    this.top5StatusError = null;

    try {
      if (currentStatus === 'selected') {
        await this.adminService.clearTopMatchSelection(menteeUid, match);
      } else {
        await this.adminService.updateTopMatchStatus(menteeUid, match, nextStatus);
      }

      match.decision = nextStatus === 'available'
        ? 'pending'
        : nextStatus === 'notInterested'
          ? 'passed'
          : 'selected';
      match.isSelected = match.decision === 'selected';
      this.updateCachedAssignmentAvailability(menteeUid, match.mentorKey, match.id, match.isSelected);
    } catch (error) {
      this.top5StatusError = error instanceof Error
        ? error.message
        : 'Unable to update this match status. Please try again.';
      select.value = currentStatus;
    } finally {
      this.updatingTop5MatchId = null;
    }
  }

  async toggleTop5(menteeUid: string): Promise<void> {
    if (this.expandedTop5MenteeId === menteeUid) {
      this.closeTop5();
      return;
    }

    if (this.expandedTop5MenteeId) {
      this.closeTop5(() => void this.openTop5(menteeUid));
      return;
    }

    await this.openTop5(menteeUid);
  }

  private async openTop5(menteeUid: string): Promise<void> {
    this.closingTop5MenteeId = null;
    this.openingTop5MenteeId = menteeUid;
    this.expandedTop5MenteeId = menteeUid;
    this.top5OpenTimer = setTimeout(() => {
      if (this.openingTop5MenteeId === menteeUid) {
        this.openingTop5MenteeId = null;
      }
      this.top5OpenTimer = null;
    });
    await this.loadTop5(menteeUid);
  }

  private closeTop5(afterClose?: () => void): void {
    const menteeUid = this.expandedTop5MenteeId;

    if (!menteeUid) {
      afterClose?.();
      return;
    }

    if (this.top5CloseTimer) {
      clearTimeout(this.top5CloseTimer);
    }

    this.closingTop5MenteeId = menteeUid;
    this.top5CloseTimer = setTimeout(() => {
      if (this.closingTop5MenteeId !== menteeUid) {
        return;
      }

      this.expandedTop5MenteeId = null;
      this.closingTop5MenteeId = null;
      this.top5CloseTimer = null;
      afterClose?.();
    }, this.top5AnimationDurationMs);
  }

  getTop5Matches(menteeUid: string): AdminTopMatch[] | undefined {
    return this.topMatchesByMenteeId.get(menteeUid);
  }

  isTop5Loading(menteeUid: string): boolean {
    return this.loadingTop5MenteeIds.has(menteeUid);
  }

  hasTop5LoadError(menteeUid: string): boolean {
    return this.top5LoadErrors.has(menteeUid);
  }

  openMatchReason(match: AdminTopMatch): void {
    this.selectedTop5Match = match;
  }

  closeMatchReason(): void {
    this.selectedTop5Match = null;
  }

  getLocalizedArray(value: LegacyLocalizedField<string[]>): string[] {
    return Array.isArray(value)
      ? value
      : value[this.languageService.language()] ?? value.en ?? value.he ?? [];
  }

  getTopMatchDetails(matchId: string): Pick<Match, 'reasons' | 'matchedAreas'> | undefined {
    return this.topMatchDetailsById.get(matchId);
  }

  private async loadTop5(menteeUid: string): Promise<void> {
    if (this.topMatchesByMenteeId.has(menteeUid) || this.loadingTop5MenteeIds.has(menteeUid)) {
      return;
    }

    const cacheVersion = this.top5CacheVersion;
    this.loadingTop5MenteeIds.add(menteeUid);
    this.top5LoadErrors.delete(menteeUid);

    try {
      const { topMatches, matchDetailsById } = await this.adminService.getTopMatches(
        menteeUid,
        this.dashboard?.mentorRows ?? []
      );

      if (cacheVersion === this.top5CacheVersion) {
        this.topMatchesByMenteeId.set(menteeUid, topMatches);
        matchDetailsById.forEach((details, matchId) => this.topMatchDetailsById.set(matchId, details));
      }
    } catch {
      if (cacheVersion === this.top5CacheVersion) {
        this.top5LoadErrors.add(menteeUid);
      }
    } finally {
      if (cacheVersion === this.top5CacheVersion) {
        this.loadingTop5MenteeIds.delete(menteeUid);
      }
    }
  }

  private clearTop5Cache(): void {
    if (this.top5OpenTimer) {
      clearTimeout(this.top5OpenTimer);
      this.top5OpenTimer = null;
    }

    if (this.top5CloseTimer) {
      clearTimeout(this.top5CloseTimer);
      this.top5CloseTimer = null;
    }

    this.openingTop5MenteeId = null;
    this.closingTop5MenteeId = null;
    this.top5CacheVersion += 1;
    this.topMatchesByMenteeId.clear();
    this.topMatchDetailsById.clear();
    this.loadingTop5MenteeIds.clear();
    this.top5LoadErrors.clear();
  }

  private updateCachedAssignmentAvailability(
    menteeUid: string,
    mentorKey: string,
    matchId: string,
    isAssigned: boolean
  ): void {
    const dashboard = this.dashboard;

    if (dashboard) {
      const mentee = dashboard.rows.find(row => row.id === menteeUid);
      const mentor = dashboard.mentorRows.find(row => row.id === mentorKey);

      if (mentee) {
        const wasSelected = mentee.selectionStatus === 'selected';
        mentee.selectionStatus = isAssigned ? 'selected' : 'waiting';
        mentee.selectedMatchId = isAssigned ? matchId : undefined;
        mentee.selectedMentorKey = isAssigned ? mentorKey : undefined;
        mentee.selectedMentorRank = isAssigned
          ? this.topMatchesByMenteeId.get(menteeUid)?.find(match => match.mentorKey === mentorKey)?.rank
          : undefined;
        mentee.selectedAt = isAssigned ? new Date() : undefined;
        mentee.mentorName = isAssigned ? mentor?.mentorFullName ?? null : null;
        mentee.mentorEmail = isAssigned ? mentor?.mentorEmail ?? null : null;

        if (wasSelected !== isAssigned) {
          dashboard.selectedCount += isAssigned ? 1 : -1;
          dashboard.waitingCount += isAssigned ? -1 : 1;
          dashboard.assignedMentorsCount += isAssigned ? 1 : -1;
          dashboard.selectionPercentage = dashboard.totalMentees
            ? Math.round((dashboard.selectedCount / dashboard.totalMentees) * 100)
            : 0;
          dashboard.recentSelections = dashboard.rows
            .filter(row => row.selectionStatus === 'selected')
            .sort((left, right) => this.getTimestampMillis(right.selectedAt) - this.getTimestampMillis(left.selectedAt))
            .slice(0, 5);
        }
      }

      if (mentor) {
        mentor.assignmentStatus = isAssigned ? 'assigned' : 'available';
        mentor.assignedMenteeUid = isAssigned ? menteeUid : null;
        mentor.assignedMenteeName = isAssigned && mentee ? this.getMenteeName(mentee) : null;
        mentor.assignedMenteeEmail = isAssigned && mentee ? mentee.email : null;
        mentor.assignedAt = isAssigned ? new Date() : undefined;
      }
    }

    this.topMatchesByMenteeId.forEach((matches, cachedMenteeUid) => {
      matches
        .filter(match => match.mentorKey === mentorKey)
        .forEach(match => {
          match.isUnavailable = isAssigned && cachedMenteeUid !== menteeUid;
        });
    });
  }

  private compareMenteeRows(left: AdminMenteeRow, right: AdminMenteeRow): number {
    let comparison: number;

    switch (this.menteeSortKey) {
      case 'status':
        comparison = left.selectionStatus.localeCompare(right.selectionStatus);
        break;
      case 'lastLoginAt':
        comparison = this.getTimestampMillis(left.lastLoginAt) - this.getTimestampMillis(right.lastLoginAt);
        break;
      case 'selectedAt':
        comparison = this.getTimestampMillis(left.selectedAt) - this.getTimestampMillis(right.selectedAt);
        break;
      case 'selectedRank':
        comparison = (left.selectedMentorRank ?? -1) - (right.selectedMentorRank ?? -1);
        break;
      default:
        comparison = this.getMenteeName(left).localeCompare(this.getMenteeName(right));
    }

    return this.menteeSortDirection === 'asc' ? comparison : -comparison;
  }

  private getTimestampMillis(value: unknown): number {
    return this.getDate(value)?.getTime() ?? 0;
  }

  private getDate(value: unknown): Date | null {
    if (!value || typeof value !== 'object' || !('toDate' in value)) {
      return null;
    }

    const date = (value as { toDate: () => Date }).toDate();

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private configureExportSheet(sheet: import('xlsx').WorkSheet, widths: number[]): void {
    sheet['!cols'] = widths.map(width => ({ wch: width }));
    sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1' };
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
