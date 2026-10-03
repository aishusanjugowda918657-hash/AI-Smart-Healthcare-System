# Role-Based Login Flow

## Overview
This application uses a unified role-based login system. Users log in through a single, secure login form without needing to manually specify or trust their role from the frontend.

## Role Route Mapping
The client application centralizes the routing of roles in `config/roles.js`. Protected routes enforce that users are sent to their mapped home route if they attempt to access unauthorized paths.
```javascript
export const ROLE_ROUTES = {
  patient: '/patient',
  doctor: '/doctor',
  admin: '/admin',
  nurse: '/nurse',
  reception: '/reception',
  pharmacy: '/pharmacy'
};
```

## Security Design & Verification Method
1. **Authentication:** The user provides an email and password which is authenticated against Firebase Authentication.
2. **Server-Side Verification:** After Firebase login, the client receives a Firebase ID Token. This token is transmitted to the backend `POST /api/auth/login-sync`. 
3. **Role Determination:** The backend decodes the token and checks the authenticated user's authoritative role stored in the Firestore `users` collection.
4. **Redirection:** The backend returns the verified role to the frontend. The `AuthContext` consumes this role and securely redirects the user to the correct dashboard path as defined in `ROLE_ROUTES`.
5. **Route Protection:** All routes enforce Role-Based Access Control (RBAC). Both the React Router logic (`ProtectedRoute.jsx`) and the backend Express Middleware (`authMiddleware.js`) strictly prevent unauthorized roles from accessing other dashboards or API resources. 

## Security Rules Evaluated
- **Strict Role Parsing:** The backend exclusively trusts the Firebase custom claim or the `users` document `role` property. Any role sent by the client is safely ignored.
- **Registration Sandboxing:** Public registration (`POST /api/auth/register`) strictly sets the role to `patient`. Privilege escalation through registration parameter injection is prevented.
- **Unknown Roles Rejected:** Tokens missing a role or carrying an unrecognized role do not default to `patient`. Instead, the middleware terminates the request with a `401 Unauthorized` status, prompting a re-login.
- **Authoritative Redirects:** `ProtectedRoute.jsx` intercepts requests where the `userRole` does not match the `allowedRoles`. It instantly routes the user back to their defined `ROLE_ROUTES` dashboard.
