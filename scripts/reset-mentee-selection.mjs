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

await db.runTransaction(async transaction => {
  const menteeSnapshot = await transaction.get(menteeRef);

  if (!menteeSnapshot.exists) {
    throw new Error(`Mentee profile not found for ${menteeEmail}.`);
  }

  const selectedMentorKey = menteeSnapshot.get('selectedMentorKey');
  const selectedMatchId = menteeSnapshot.get('selectedMatchId');

  if (typeof selectedMentorKey !== 'string' || !selectedMentorKey) {
    throw new Error(`No final mentor selection found for ${menteeEmail}.`);
  }

  if (typeof selectedMatchId !== 'string' || !selectedMatchId) {
    throw new Error(`Selected match ID is missing for ${menteeEmail}.`);
  }

  const assignmentRef = db.collection('mentorAssignments').doc(selectedMentorKey);
  const selectedMatchRef = db.collection('matches').doc(selectedMatchId);
  const [selectedMatchSnapshot, assignmentSnapshot] = await Promise.all([
    transaction.get(selectedMatchRef),
    transaction.get(assignmentRef)
  ]);

  if (
    !selectedMatchSnapshot.exists
    || selectedMatchSnapshot.get('menteeId') !== authUser.uid
    || selectedMatchSnapshot.get('mentorKey') !== selectedMentorKey
    || selectedMatchSnapshot.get('decision') !== 'selected'
  ) {
    throw new Error(`Selected match is invalid for ${menteeEmail}.`);
  }

  if (!assignmentSnapshot.exists || assignmentSnapshot.get('menteeUid') !== authUser.uid) {
    throw new Error(`Mentor assignment is invalid for ${menteeEmail}.`);
  }

  transaction.delete(assignmentRef);
  transaction.update(menteeRef, {
    selectedMatchId: FieldValue.delete(),
    selectedMentorKey: FieldValue.delete(),
    selectedMentorRank: FieldValue.delete(),
    selectedAt: FieldValue.delete()
  });
  transaction.update(selectedMatchRef, { decision: 'pending' });
});

console.log(`Reset final mentor selection for ${menteeEmail}.`);
