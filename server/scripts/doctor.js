import { db } from '../src/config/firebase.js';

async function runDoctor() {
  console.log('Running Doctor checks...');
  
  // 1. Index probe for bookingController slots query
  const todayStr = new Date().toISOString().split('T')[0];
  console.log('Probing composite index for next available slots query...');
  try {
    const slotsSnap = await db.collection('slots')
      .where('doctorId', 'in', ['DOC-001', 'DOC-002'])
      .where('date', '>=', todayStr)
      .where('date', '<=', todayStr)
      .where('status', '==', 'free')
      .orderBy('date')
      .orderBy('startAt')
      .limit(1)
      .get();
    console.log('Index probe successful. Query executed without errors.');
  } catch (error) {
    console.error('Index probe failed! Missing index?');
    console.error(error.message);
  }

  // 2. Check doctors with no future slots
  console.log('\nChecking doctor slot status...');
  const docsSnap = await db.collection('doctors').where('active', '==', true).get();
  for (const doc of docsSnap.docs) {
    const doctor = doc.data();
    const targetId = doctor.doctorId || doc.id;
    const slotsSnap = await db.collection('slots')
      .where('doctorId', '==', targetId)
      .where('date', '>=', todayStr)
      .where('status', '==', 'free')
      .limit(1)
      .get();
    if (slotsSnap.empty) {
      console.warn(`Doctor ${doctor.name || doctor.fullName} has no future slots`);
    }
  }

  console.log('\nDoctor checks completed.');
}

runDoctor().catch(console.error).finally(() => process.exit(0));
