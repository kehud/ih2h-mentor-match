import fs from 'node:fs';
import path from 'node:path';

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SERVICE_ACCOUNT_PATH = path.resolve(
  'private/mentor-mentee-mvp-firebase-adminsdk-fbsvc-8d1faf26c9.json'
);
const args = process.argv.slice(2);
const shouldDelete = args.includes('--delete');

if (args.some(arg => arg !== '--delete')) {
  console.error('Usage: node scripts/cleanup-legacy-matches.mjs [--delete]');
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

const db = getFirestore();
const matchesSnapshot = await db.collection('matches').get();
const legacyMatches = matchesSnapshot.docs.filter(match => {
  const data = match.data();

  return 'mentorName' in data || 'mentorEmail' in data;
});

console.log(`Legacy matches found: ${legacyMatches.length}`);

if (!shouldDelete) {
  for (const match of legacyMatches) {
    const data = match.data();
    const details = { documentId: match.id };
    const ownerFieldNames = ['userId', 'uid', 'menteeId', 'menteeUid', 'menteeEmail'];
    const existingOwnerFields = ownerFieldNames.filter(fieldName => fieldName in data);

    for (const fieldName of existingOwnerFields) {
      details[fieldName] = data[fieldName];
    }

    if (!existingOwnerFields.length) {
      details.fieldNames = Object.keys(data).sort();
    }

    if ('mentorName' in data) {
      details.mentorName = data.mentorName;
    }

    if ('generatedAt' in data) {
      details.generatedAt = data.generatedAt?.toDate?.().toISOString?.() ?? data.generatedAt;
    }

    console.log(details);
  }

  console.log('Dry run only. Re-run with --delete to remove these documents.');
  process.exit(0);
}

if (!legacyMatches.length) {
  console.log('No legacy matches to delete.');
  process.exit(0);
}

for (let index = 0; index < legacyMatches.length; index += 500) {
  const batch = db.batch();

  for (const match of legacyMatches.slice(index, index + 500)) {
    batch.delete(match.ref);
  }

  await batch.commit();
}

console.log(`Deleted ${legacyMatches.length} legacy matches.`);
