import fs from 'node:fs';
import path from 'node:path';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const SERVICE_ACCOUNT_PATH = path.resolve(
  'private/mentor-mentee-mvp-firebase-adminsdk-fbsvc-8d1faf26c9.json'
);

const inputFile = process.argv[2];

if (!inputFile) {
  console.error(
    'Usage: npm run import-matches -- /path/to/matches_output.xlsx'
  );
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(
    `Firebase service account not found: ${SERVICE_ACCOUNT_PATH}`
  );
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Matches file not found: ${inputFile}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')
);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const workbook = XLSX.readFile(inputFile, {
  cellDates: true
});

const sheet = workbook.Sheets[workbook.SheetNames[0]];

const rows = XLSX.utils.sheet_to_json(sheet, {
  defval: ''
});

const requiredColumns = [
  'menteeEmail',
  'rank',
  'matchScore',
  'mentorName',
  'mentorBio',
  'mentorProfessionalBackground',
  'mentorInterests',
  'reasons',
  'matchedAreas',
  'decision',
  'generatedAt'
];

if (!rows.length) {
  console.error('The Excel file contains no match rows.');
  process.exit(1);
}

for (const column of requiredColumns) {
  if (!(column in rows[0])) {
    console.error(`Missing required column: ${column}`);
    process.exit(1);
  }
}

function parseJsonArray(value, fieldName) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(String(value));

    if (!Array.isArray(parsed)) {
      throw new Error('Value is not an array');
    }

    return parsed;
  } catch {
    throw new Error(
      `Invalid JSON array in field "${fieldName}": ${value}`
    );
  }
}

function toTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Timestamp.fromDate(value);
  }

  if (typeof value === 'number') {
    // Excel date serial → JavaScript Date
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return Timestamp.fromDate(
        new Date(
          Date.UTC(
            parsed.y,
            parsed.m - 1,
            parsed.d,
            parsed.H ?? 0,
            parsed.M ?? 0,
            Math.floor(parsed.S ?? 0)
          )
        )
      );
    }
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return Timestamp.fromDate(date);
    }
  }

  return Timestamp.now();
}

const rowsByMentee = new Map();

for (const row of rows) {
  const email = String(row.menteeEmail)
    .trim()
    .toLowerCase();

  if (!email) {
    throw new Error('Found a match row without menteeEmail.');
  }

  if (!rowsByMentee.has(email)) {
    rowsByMentee.set(email, []);
  }

  rowsByMentee.get(email).push(row);
}

console.log(`Found ${rows.length} match rows.`);
console.log(`Affected mentees: ${rowsByMentee.size}`);
console.log('');

for (const [email, menteeRows] of rowsByMentee.entries()) {
  console.log(`Processing ${email}...`);

  const menteeSnapshot = await db
    .collection('mentees')
    .where('email', '==', email)
    .get();

  if (menteeSnapshot.empty) {
    throw new Error(
      `No mentee found in Firestore with email: ${email}`
    );
  }

  if (menteeSnapshot.size > 1) {
    throw new Error(
      `More than one mentee found with email: ${email}`
    );
  }

  const menteeDocument = menteeSnapshot.docs[0];

  // By our MVP convention:
  // mentees/{documentId} === Firebase Auth UID === menteeId
  const menteeId = menteeDocument.id;

  const sortedRows = [...menteeRows].sort(
    (a, b) => Number(a.rank) - Number(b.rank)
  );

  if (sortedRows.length > 5) {
    throw new Error(
      `${email} has ${sortedRows.length} matches. Maximum is 5.`
    );
  }

  const existingMatches = await db
    .collection('matches')
    .where('menteeId', '==', menteeId)
    .get();

  const batch = db.batch();

  // Replace only this mentee's old matches.
  for (const document of existingMatches.docs) {
    batch.delete(document.ref);
  }

  for (const row of sortedRows) {
    const rank = Number(row.rank);
    const matchScore = Number(row.matchScore);

    if (!Number.isInteger(rank) || rank < 1 || rank > 5) {
      throw new Error(
        `Invalid rank for ${email}: ${row.rank}`
      );
    }

    if (
      !Number.isFinite(matchScore) ||
      matchScore < 0 ||
      matchScore > 100
    ) {
      throw new Error(
        `Invalid matchScore for ${email}, rank ${rank}: ${row.matchScore}`
      );
    }

    const matchRef = db.collection('matches').doc();

    batch.set(matchRef, {
      menteeId,
      rank,
      matchScore,

      mentorName: String(row.mentorName).trim(),
      mentorBio: String(row.mentorBio).trim(),
      mentorProfessionalBackground: String(
        row.mentorProfessionalBackground
      ).trim(),

      mentorInterests: parseJsonArray(
        row.mentorInterests,
        'mentorInterests'
      ),

      reasons: parseJsonArray(
        row.reasons,
        'reasons'
      ),

      matchedAreas: parseJsonArray(
        row.matchedAreas,
        'matchedAreas'
      ),

      decision: String(row.decision || 'pending').trim(),

      generatedAt: toTimestamp(row.generatedAt)
    });
  }

  await batch.commit();

  console.log(
    `✓ ${email}: replaced ${existingMatches.size} old matches with ${sortedRows.length} new matches`
  );
}

console.log('');
console.log('✓ Firebase import completed successfully.');
