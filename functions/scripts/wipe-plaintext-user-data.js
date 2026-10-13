// One-off cleanup: deletes financial data stored before encryption shipped,
// keeping Auth users, payments and Pro status. Wiped accounts are sent back
// through onboarding on their next login.
//
//   node scripts/wipe-plaintext-user-data.js           # dry run
//   node scripts/wipe-plaintext-user-data.js --apply   # write changes
//
// Needs Application Default Credentials (`gcloud auth application-default login`)
// or GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key.
const admin = require('firebase-admin');

const PROJECT_ID = 'salarywise-174ef';
const APPLY = process.argv.includes('--apply');
// Fields left on an unencrypted users/{uid} doc. Pro status is server-written
// from a verified payment; `onboarded` is reset to false.
const KEEP_KEYS = ['proUnlocked', 'proUnlockedAt', 'onboarded'];
const PAGE_SIZE = 200;
const MAX_BATCH_WRITES = 450;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

let batch = db.batch();
let batchWrites = 0;

async function queue(write) {
  write(batch);
  batchWrites++;
  if (batchWrites >= MAX_BATCH_WRITES) await flush();
}

async function flush() {
  if (APPLY && batchWrites > 0) await batch.commit();
  batch = db.batch();
  batchWrites = 0;
}

async function main() {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} against ${PROJECT_ID}\n`);
  const totals = { users: 0, encrypted: 0, wipedProfiles: 0, deletedExpenses: 0 };

  let last = null;
  for (;;) {
    let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;

    for (const userSnap of page.docs) {
      totals.users++;
      const data = userSnap.data();
      const encrypted = data.keyWrap != null;
      if (encrypted) totals.encrypted++;

      const expenses = await userSnap.ref.collection('expenses').get();
      // Encrypted accounts only lose stragglers a failed migration left behind.
      const plaintextExpenses = expenses.docs.filter((d) => !encrypted || typeof d.get('enc') !== 'string');

      const plaintextFields = encrypted ? [] : Object.keys(data).filter((k) => !KEEP_KEYS.includes(k));
      const resetOnboarding = !encrypted && data.onboarded !== false;
      if (plaintextFields.length === 0 && !resetOnboarding && plaintextExpenses.length === 0) continue;

      // Field names only — never print the values.
      console.log(
        `${userSnap.id}  ${encrypted ? 'encrypted' : 'UNENCRYPTED'}  ` +
          `fields=[${plaintextFields.join(', ')}]  expenses=${plaintextExpenses.length}`
      );

      if (!encrypted) {
        const update = { onboarded: false };
        for (const k of plaintextFields) update[k] = admin.firestore.FieldValue.delete();
        await queue((b) => b.update(userSnap.ref, update));
        totals.wipedProfiles++;
      }
      for (const d of plaintextExpenses) {
        await queue((b) => b.delete(d.ref));
        totals.deletedExpenses++;
      }
    }
    last = page.docs[page.docs.length - 1];
  }
  await flush();

  console.log(
    `\nUsers scanned: ${totals.users} (${totals.encrypted} already encrypted)\n` +
      `Profiles ${APPLY ? 'wiped' : 'to wipe'}: ${totals.wipedProfiles}\n` +
      `Plaintext expenses ${APPLY ? 'deleted' : 'to delete'}: ${totals.deletedExpenses}`
  );
  if (!APPLY) console.log('\nNothing written. Re-run with --apply to make these changes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
