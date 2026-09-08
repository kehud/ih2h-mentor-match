import fs from 'node:fs';
import path from 'node:path';

import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const SERVICE_ACCOUNT_PATH = path.resolve(
  'private/mentor-mentee-mvp-firebase-adminsdk-fbsvc-8d1faf26c9.json'
);
const menteeEmail = String(process.argv[2] ?? '').trim().toLowerCase();

if (!menteeEmail || process.argv.length !== 3) {
  console.error('Usage: node scripts/reset-mentee-selection.mjs <mentee-email>');
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Firebase service account not found: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')
);

initializeApp({
  credential: cert(serviceAccount)
});

const auth = getAuth();
const db = getFirestore();
const authUser = await auth.getUserByEmail(menteeEmail);
const menteeRef = db.collection('mentees').doc(authUser.uid);
const matchesQuery = db.collection('matches').where('menteeId', '==', authUser.uid);

await db.runTransaction(async transaction => {
  const menteeSnapshot = await transaction.get(menteeRef);

  if (!menteeSnapshot.exists) {
    throw new Error(`Mentee profile not found for ${menteeEmail}.`);
  }

  const selectedMentorKey = menteeSnapshot.get('selectedMentorKey');

  if (typeof selectedMentorKey !== 'string' || !selectedMentorKey) {
    throw new Error(`No final mentor selection found for ${menteeEmail}.`);
  }

  const assignmentRef = db.collection('mentorAssignments').doc(selectedMentorKey);
  const [matchesSnapshot] = await Promise.all([
    transaction.get(matchesQuery),
    transaction.get(assignmentRef)
  ]);
  const selectedMatches = matchesSnapshot.docs.filter(match => {
    const data = match.data();

    return data.mentorKey === selectedMentorKey && data.decision === 'selected';
  });

  if (selectedMatches.length !== 1) {
    throw new Error(
      `Expected exactly one selected match for ${menteeEmail}; found ${selectedMatches.length}.`
    );
  }

  transaction.delete(assignmentRef);
  transaction.update(menteeRef, {
    selectedMentorKey: FieldValue.delete(),
    selectedMentorRank: FieldValue.delete(),
    selectedAt: FieldValue.delete()
  });
  transaction.update(selectedMatches[0].ref, { decision: 'pending' });
});

console.log(`Reset final mentor selection for ${menteeEmail}.`);
