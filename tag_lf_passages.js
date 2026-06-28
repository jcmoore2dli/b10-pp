const admin = require('firebase-admin');
const sa = require('./key/b10-pp-firebase-adminsdk-260525.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const LF_PASSAGES = {
  WFF: ['EDU-013','GOV-019','TEC-009','ENV-006','HLT-029','ECN-003','JUS-016','SOC-003'],
  SV:  ['HLT-002','ECN-019','GOV-020','INT-010','TEC-005','ENV-004','JUS-006','CUL-004'],
  SC:  ['WRK-001','ENV-021','HLT-030','ECN-015','GOV-017','INT-015','TEC-021','CUL-009'],
  PI:  ['EDU-008','HLT-003','SOC-002','JUS-013','ECN-002','ENV-020','CUL-003','GOV-016'],
};

async function tagPassages() {
  let tagged = 0, missing = 0;
  for (const [subcat, ids] of Object.entries(LF_PASSAGES)) {
    for (const id of ids) {
      const ref = db.collection('passages').doc(id);
      const doc = await ref.get();
      if (!doc.exists) {
        console.log(`MISSING: ${id}`);
        missing++;
        continue;
      }
      await ref.update({ lfSubcategory: subcat });
      console.log(`TAGGED:  ${id} → ${subcat}`);
      tagged++;
    }
  }
  console.log(`\nDone. Tagged: ${tagged}  Missing: ${missing}`);
  process.exit(0);
}

tagPassages().catch(e => { console.error(e); process.exit(1); });
