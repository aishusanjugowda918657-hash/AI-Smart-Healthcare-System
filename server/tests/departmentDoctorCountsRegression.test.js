import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Hospital Departments & Clinical Staff Active Counts Regression', () => {
  let db;
  const testDeptIds = new Set();
  const testDoctorIds = new Set();

  beforeEach(() => {
    db = assertDbConnected();
  });

  afterEach(async () => {
    // Clean up test records
    for (const dId of testDeptIds) {
      try {
        await db.collection('departments').doc(dId).delete();
      } catch (_) {}
    }
    for (const docId of testDoctorIds) {
      try {
        await db.collection('doctors').doc(docId).delete();
      } catch (_) {}
    }
    testDeptIds.clear();
    testDoctorIds.clear();
  });

  it('GET /api/departments calculates activeDoctors matching doctors collection exactly', async () => {
    const unique = Date.now();
    const deptId1 = `dept-test-card-${unique}`;
    const deptId2 = `dept-test-gen-${unique}`;
    testDeptIds.add(deptId1);
    testDeptIds.add(deptId2);

    await db.collection('departments').doc(deptId1).set({
      id: deptId1,
      name: 'Test Cardiology Wing',
      code: 'TCARD',
      active: true,
      createdAt: new Date()
    });

    await db.collection('departments').doc(deptId2).set({
      id: deptId2,
      name: 'Test General Wing',
      code: 'TGEN',
      active: true,
      createdAt: new Date()
    });

    // Seed 2 active doctors in dept 1
    const doc1 = `doc-test-1-${unique}`;
    const doc2 = `doc-test-2-${unique}`;
    testDoctorIds.add(doc1);
    testDoctorIds.add(doc2);

    await db.collection('doctors').doc(doc1).set({
      doctorId: doc1,
      name: 'Dr. Test Active A',
      departmentId: deptId1,
      status: 'ACTIVE'
    });

    await db.collection('doctors').doc(doc2).set({
      doctorId: doc2,
      name: 'Dr. Test Active B',
      departmentId: deptId1,
      status: 'ACTIVE'
    });

    // Seed 1 active doctor and 1 INACTIVE doctor in dept 2
    const doc3 = `doc-test-3-${unique}`;
    const doc4 = `doc-test-4-${unique}`;
    testDoctorIds.add(doc3);
    testDoctorIds.add(doc4);

    await db.collection('doctors').doc(doc3).set({
      doctorId: doc3,
      name: 'Dr. Test Active C',
      departmentId: deptId2,
      status: 'ACTIVE'
    });

    await db.collection('doctors').doc(doc4).set({
      doctorId: doc4,
      name: 'Dr. Test Inactive D',
      departmentId: deptId2,
      status: 'INACTIVE'
    });

    // Query departments
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const depts = res.body.data;
    const foundDept1 = depts.find(d => d.id === deptId1);
    const foundDept2 = depts.find(d => d.id === deptId2);

    expect(foundDept1).toBeDefined();
    expect(foundDept1.activeDoctors).toBe(2);

    expect(foundDept2).toBeDefined();
    // Inactive doctor must not be counted
    expect(foundDept2.activeDoctors).toBe(1);
  });

  it('GET /api/doctors returns doctors with normalized status field', async () => {
    const unique = Date.now();
    const docId = `doc-test-norm-${unique}`;
    testDoctorIds.add(docId);

    // Save doctor without explicit status
    await db.collection('doctors').doc(docId).set({
      doctorId: docId,
      name: 'Dr. Unspecified Status',
      departmentId: 'dept-gen'
    });

    const res = await request(app).get('/api/doctors');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const targetDoc = res.body.data.find(d => d.id === docId || d.doctorId === docId);
    expect(targetDoc).toBeDefined();
    expect(targetDoc.status).toBe('ACTIVE');
  });

  it('POST /api/departments creates new department with room and wing attributes', async () => {
    const unique = Date.now();
    const deptId = `dept-tnew-${unique}`;
    testDeptIds.add(deptId);

    const res = await request(app)
      .post('/api/departments')
      .set('x-demo-uid', 'admin-uid-test')
      .set('x-demo-role', 'admin')
      .send({
        id: deptId,
        name: 'Telemedicine & Remote Care',
        code: 'TELE',
        letter: 'T',
        room: 'Virtual Clinic 01',
        wing: 'North Wing',
        description: 'Remote tele-consultations'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Telemedicine & Remote Care');
    expect(res.body.data.room).toBe('Virtual Clinic 01');
    expect(res.body.data.wing).toBe('North Wing');

    // Verify it appears in GET /api/departments
    const getRes = await request(app).get('/api/departments');
    const created = getRes.body.data.find(d => d.id === deptId);
    expect(created).toBeDefined();
    expect(created.room).toBe('Virtual Clinic 01');
    expect(created.activeDoctors).toBe(0);
  });
});
