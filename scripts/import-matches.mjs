import fs from 'node:fs';
import path from 'node:path';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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
const auth = getAuth();

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
  'mentorBioEn',
  'mentorBioHe',
  'mentorProfessionalBackgroundEn',
  'mentorProfessionalBackgroundHe',
  'mentorInterestsEn',
  'mentorInterestsHe',
  'reasonsEn',
  'reasonsHe',
  'matchedAreasEn',
  'matchedAreasHe',
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

function parseRequiredJsonArray(value, fieldName) {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error(
          `Invalid item at index ${index} in field "${fieldName}". Expected a non-empty string.`
        );
      }

      return item.trim();
    });
  }

  if (value === null || value === undefined || !String(value).trim()) {
    throw new Error(`Missing required JSON array in field "${fieldName}".`);
  }

  try {
    const parsed = JSON.parse(String(value));

    if (!Array.isArray(parsed)) {
      throw new Error('Value is not an array');
    }

    return parseRequiredJsonArray(parsed, fieldName);
  } catch {
    throw new Error(
      `Invalid JSON array in field "${fieldName}": ${value}`
    );
  }
}

function requiredString(value, fieldName, email, rank) {
  const text = String(value ?? '').trim();

  if (!text) {
    throw new Error(
      `Missing required field "${fieldName}" for ${email}, rank ${rank}.`
    );
  }

  return text;
}

function validateLocalizedFields(row) {
  const email = String(row.menteeEmail ?? '').trim().toLowerCase() || '(missing email)';
  const rank = String(row.rank ?? '').trim() || '(missing rank)';

  requiredString(row.mentorName, 'mentorName', email, rank);
  requiredString(row.mentorBioEn, 'mentorBioEn', email, rank);
  requiredString(row.mentorBioHe, 'mentorBioHe', email, rank);
  requiredString(
    row.mentorProfessionalBackgroundEn,
    'mentorProfessionalBackgroundEn',
    email,
    rank
  );
  requiredString(
    row.mentorProfessionalBackgroundHe,
    'mentorProfessionalBackgroundHe',
    email,
    rank
  );
  parseRequiredJsonArray(row.mentorInterestsEn, 'mentorInterestsEn');
  parseRequiredJsonArray(row.mentorInterestsHe, 'mentorInterestsHe');
  parseRequiredJsonArray(row.reasonsEn, 'reasonsEn');
  parseRequiredJsonArray(row.reasonsHe, 'reasonsHe');
  parseRequiredJsonArray(row.matchedAreasEn, 'matchedAreasEn');
  parseRequiredJsonArray(row.matchedAreasHe, 'matchedAreasHe');
}

function getMenteeNames(displayName) {
  if (typeof displayName !== 'string') {
    return { firstName: '', lastName: '' };
  }

  const nameParts = displayName.trim().split(/\s+/).filter(Boolean);

  if (nameParts.length < 2) {
    return { firstName: '', lastName: '' };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' ')
  };
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

// Validate the bilingual payload for every row before any existing matches are replaced.
for (const row of rows) {
  validateLocalizedFields(row);
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

  let authUser;

  try {
    authUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw new Error(
        `No Firebase Auth user found for ${email}. Create the Auth user first, then run this import again.`
      );
    }

    throw error;
  }

  // Firebase Authentication is the canonical source for the mentee UID.
  const menteeId = authUser.uid;
  const userRef = db.collection('users').doc(menteeId);
  const menteeRef = db.collection('mentees').doc(menteeId);
  const [userSnapshot, menteeSnapshot] = await Promise.all([
    userRef.get(),
    menteeRef.get()
  ]);

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

  if (!userSnapshot.exists) {
    batch.set(userRef, {
      email,
      role: 'mentee'
    });
  }

  if (!menteeSnapshot.exists) {
    const { firstName, lastName } = getMenteeNames(authUser.displayName);

    batch.set(menteeRef, {
      email,
      firstName,
      lastName,
      status: 'active',
      createdAt: Timestamp.now()
    });
  }

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

    const mentorBio = {
      en: requiredString(row.mentorBioEn, 'mentorBioEn', email, rank),
      he: requiredString(row.mentorBioHe, 'mentorBioHe', email, rank)
    };
    const mentorProfessionalBackground = {
      en: requiredString(
        row.mentorProfessionalBackgroundEn,
        'mentorProfessionalBackgroundEn',
        email,
        rank
      ),
      he: requiredString(
        row.mentorProfessionalBackgroundHe,
        'mentorProfessionalBackgroundHe',
        email,
        rank
      )
    };
    const mentorInterests = {
      en: parseRequiredJsonArray(row.mentorInterestsEn, 'mentorInterestsEn'),
      he: parseRequiredJsonArray(row.mentorInterestsHe, 'mentorInterestsHe')
    };
    const reasons = {
      en: parseRequiredJsonArray(row.reasonsEn, 'reasonsEn'),
      he: parseRequiredJsonArray(row.reasonsHe, 'reasonsHe')
    };
    const matchedAreas = {
      en: parseRequiredJsonArray(row.matchedAreasEn, 'matchedAreasEn'),
      he: parseRequiredJsonArray(row.matchedAreasHe, 'matchedAreasHe')
    };

    const matchRef = db.collection('matches').doc();

    batch.set(matchRef, {
      menteeId,
      rank,
      matchScore,

      mentorName: requiredString(row.mentorName, 'mentorName', email, rank),
      mentorBio,
      mentorProfessionalBackground,
      mentorInterests,
      reasons,
      matchedAreas,

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
