# B10-PP Data Governance and Security Specification — MVP (v2.1)

## 0. Purpose and Scope
This document defines the data governance, security constraints, and AI interaction rules for the B10 Practice Platform (B10-PP) MVP.

This is an engineering control document. All implementation must conform.

---

## 1. Core Principles
- Data Minimization
- Identity Separation
- Ephemeral Raw Data
- Derived Data Persistence
- AI Isolation
- Fail-Closed Processing

---

## 2. Data Classification
Pseudonymous instructional data with potential re-identification risk.

---

## 3. Data Lifecycle

Audio: 14 days (auto-delete, logged)  
Transcripts: 30 days (auto-delete, logged)  
Derived Data: retained  

Phase 2 target: reduce to 14 days contingent on pipeline reliability validation

---

## 4. Data Model Rules

Allowed:
- b10Id
- scores
- tags
- feedback summaries
- timestamps

Prohibited:
- names
- emails
- units
- locations
- identity fields

Critical:
- No transcript in taskAttempts
- No b10Id in transcripts
- No identity mapping in system

---

## 5. AI Evaluation Policy

A fixed behavioral policy block must be prepended to every AI evaluation API call.
Canonical version stored in /config/aiPolicy.js.

### Redaction Handling Rule

If redaction markers appear in the transcript (e.g., [NAME REMOVED], [LOCATION REMOVED]):

- Evaluate the surrounding linguistic content as written  
- Do NOT penalize the student for the absence of the redacted term  
- Do NOT attempt to infer or reconstruct what was removed  
- Treat redacted segments as neutral placeholders with no impact on scoring  

---

## 6. Sanitization

Two-pass required:
- NER
- rule-based filtering

Fail-closed:
- no sanitization = no AI call

Logging:
- categories only

---

## 7. Access Control

Instructor:
- assigned group only
- no cross-group access
- no bulk export

Admin:
- full read

System:
- pipeline execution

---

## 8. Retention and Deletion

Audio:
- delete at 14 days

Transcripts:
- delete at 30 days
- set transcriptRef = null in taskAttempts

---

## 9. Derived Data

Store:
- scores
- tags
- structured summaries

No transcript storage long-term.

---

## 10. AI Constraints

Allowed:
- sanitized transcript

Prohibited:
- identity
- metadata
- audio

---

## 11. Audit Logging

Append-only  
No transcript content  

---

## 12. Non-Negotiables

- No identity storage
- No transcript beyond lifecycle
- No AI identity exposure
- No sanitization bypass

---

## 13. Summary

Low-risk, pseudonymous instructional system with strict lifecycle and AI isolation.

---

## 14. Document Control

Version: 2.1  
Date: 2026-04-09  
Status: Updated baseline
