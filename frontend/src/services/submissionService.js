// src/services/submissionService.js
//
// Handles the full client-side submission lifecycle:
//   1. Upload audio blob to Firebase Storage
//   2. Create submission doc in Firestore (status: "queued", submissionNumber: 0)
//   3. Subscribe to doc via onSnapshot — returns unsubscribe function
//
// ARCHITECTURAL INVARIANTS (client-side):
//   - Client never writes score, score_label, or status after initial doc creation
//   - submissionNumber: 0 on creation — server assigns real number via transaction
//   - One-active-job check runs before doc creation (UX protection only, not atomic)
//   - Double-tap protection enforced at UI level in RecordingScreen

import { db, storage } from './firebase'
import {
  collection,
  addDoc,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'

// ── uploadAudio ───────────────────────────────────────────────────────────────
// Uploads audio blob to Firebase Storage.
// Path: audio/{b10Id}/{submissionId}/recording.webm
// Returns: { audioPath: string }
export async function uploadAudio(b10Id, submissionId, audioBlob) {
  const ext = audioBlob.type.includes('mp4') ? 'mp4'
            : audioBlob.type.includes('wav') ? 'wav'
            : 'webm'
  const audioPath  = `audio/${b10Id}/${submissionId}/recording.${ext}`
  const storageRef = ref(storage, audioPath)
  await uploadBytes(storageRef, audioBlob)
  return { audioPath }
}

// ── checkActiveJob ────────────────────────────────────────────────────────────
// UX-only check — not atomic. Returns true if a queued or processing
// submission already exists for this b10Id + assignmentId combination.
// Prevents double-submission on slow connections. Not a security guarantee.
export async function checkActiveJob(b10Id, assignmentId) {
  const q = query(
    collection(db, 'submissions'),
    where('b10Id', '==', b10Id),
    where('assignmentId', '==', assignmentId),
    where('status', 'in', ['queued', 'processing'])
  )
  const snap = await getDocs(q)
  return !snap.empty
}

// ── createSubmission ──────────────────────────────────────────────────────────
// Creates submission doc in Firestore.
// Client writes only: identity fields, audioPath, status, submissionNumber placeholder.
// Server (Cloud Function) writes: score, score_label, strengths, gaps,
//   language_feedback, transcript_note, transcriptText, processedAt, taskFamily.
//
// Returns: { submissionId: string }
export async function createSubmission({
  b10Id,
  assignmentId,
  taskType,
  passageId,
  corpusType,
  audioPath,
  promptDescription,
  scaffoldConfig,
}) {
  const docRef = await addDoc(collection(db, 'submissions'), {
    b10Id,
    assignmentId,
    taskType,
    passageId,
    corpusType:        corpusType        || 'ORI',
    audioPath,
    promptDescription: promptDescription || '',
    scaffoldConfig:    scaffoldConfig    || {},
    status:            'queued',
    submissionNumber:  0,               // server assigns real number via transaction
    createdAt:         serverTimestamp(),
  })
  return { submissionId: docRef.id }
}

// ── subscribeToSubmission ─────────────────────────────────────────────────────
// Subscribes to a submission doc via onSnapshot.
// Calls onUpdate(data) on every Firestore change.
// Returns unsubscribe function — caller must invoke on component unmount.
//
// Status values the caller should handle:
//   "queued"     → pipeline not yet started
//   "processing" → pipeline running
//   "complete"   → score fields populated — render feedback
//   "failed"     → errorMessage field set — show retry
export function subscribeToSubmission(submissionId, onUpdate) {
  const docRef = doc(db, 'submissions', submissionId)
  return onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      onUpdate(snap.data())
    }
  })
}
