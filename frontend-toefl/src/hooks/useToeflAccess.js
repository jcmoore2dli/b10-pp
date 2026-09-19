import { useEffect, useState } from 'react'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { db } from '../services/firebase'
import { isToeflIdExpired, isToeflStaffClaims } from '../lib/toeflAccess'

// Decides which screen a signed-in user sees before the app proper:
//   'staff'    TOEFL staff (admins, T##-INS-# instructors), who pass by role
//   'expired'  a T account past its expiry (known from the ID year)
//   'checking' probe in flight
//   'active'   the rules let this student read TOEFL items
//   'inactive' the rules refused: not enrolled, frozen, or expired
// Students cannot read their own toeflEnrollment document, so the probe asks
// the rules directly with a one-document read of toeflItems. The result only
// picks a message; the rules are what actually block access.
export function useToeflAccess(claims) {
  const isStaff = isToeflStaffClaims(claims)
  const expired = !isStaff && isToeflIdExpired(claims?.b10Id)
  const [probe, setProbe] = useState('checking')

  useEffect(() => {
    if (isStaff || expired) return
    let cancelled = false
    setProbe('checking')
    getDocs(query(collection(db, 'toeflItems'), limit(1)))
      .then(() => { if (!cancelled) setProbe('active') })
      .catch((err) => {
        if (cancelled) return
        // Anything other than a permission refusal (e.g. offline) should not
        // tell a student their access is gone; let the app load and fail on
        // its own terms instead.
        setProbe(err?.code === 'permission-denied' ? 'inactive' : 'active')
      })
    return () => { cancelled = true }
  }, [isStaff, expired, claims?.b10Id])

  if (isStaff) return 'staff'
  if (expired) return 'expired'
  return probe
}
