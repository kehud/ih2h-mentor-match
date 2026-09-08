import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import {
  AdminDashboard,
  AdminMentee,
  AdminMenteeRow,
  AdminMentorRow
} from '../../models/admin.model';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';

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
