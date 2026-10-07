# Registration Flow Audit

## 1. Issue Overview
A critical bug was discovered in the patient registration flow: the system was creating a Firebase Auth user but failing to create the corresponding Firestore patient profile (`users` and `patients` documents). This resulted in orphaned Firebase Auth accounts that could not be used to log in because they lacked the necessary database profiles, and the system would return "Account Incomplete" or similar errors.

## 2. Root Cause Analysis
- **Non-Atomic Operations:** The original implementation relied on a Firestore `batch.commit()`. While batches are atomic for writes, any logic preceding the batch (like `generateAtomicPatientHealthId()`) that failed could cause the function to exit after the Firebase Auth user was created but before the Firestore documents were saved.
- **Rollback Failures:** A rollback mechanism existed, but it might not have been triggered if the Firebase Auth token generation or the health ID generation threw an error that wasn't properly caught in the context of the Firestore write block. 
- **Missing Transactions:** The creation of the `users` and `patients` documents should be bundled into a Firestore Transaction to ensure that reads/writes are verified securely and that any failure immediately throws, allowing the catch block to successfully roll back the Auth user.

## 3. Implementation Fixes
1. **Firestore Transaction:** Replaced `db.batch()` with `db.runTransaction()` in `authController.js` for the `users` and `patients` document creation. This guarantees atomicity and consistency during the database setup phase.
2. **Explicit Rollback Handling:** The `try-catch` block around the Firestore database setup correctly catches any transaction failures (`fsErr`) and executes `auth.deleteUser(uid)` to delete the recently created Auth account, preventing orphaned accounts.
3. **Idempotent Retry:** The system includes checks for `auth/email-already-exists`. It verifies if the `users` doc and `patients` doc exist; if they are missing, it flags the account as incomplete, allowing for future manual cleanup or prompting the user to contact support (without wiping out admin/doctor accounts).

## 4. Regression Testing
A comprehensive test suite was updated in `safeRegistration.test.js`:
- **`rolls back newly created Auth user if Firestore setup fails`**: Simulates a Firestore transaction failure and verifies that the system returns a `503` (SERVICE_UNAVAILABLE) and triggers the rollback mechanism.
- **`loginSync creates users doc and self patient profile for unprivileged user with missing profile`**: Ensures that unprivileged users with incomplete profiles can have them repaired automatically.
- **`forces role "patient" even if "admin" is requested in body`**: Ensures privilege escalation is prevented during public registration.

## 5. Orphaned Accounts
Since the system prohibits deleting existing doctor or admin accounts, any cleanup of existing orphaned accounts must be done with caution. 
- **Recommendation:** A periodic background job or administrative script should scan Firebase Auth for accounts with the `patient` role. For each account, check if the corresponding `users/{uid}` and `patients/{healthId}` documents exist. If they do not, safely delete the Auth account.
- **Immediate Mitigation:** The current fix ensures no *new* orphaned accounts will be created. The system handles existing orphans gracefully by denying them login and returning an error, without compromising system integrity.
