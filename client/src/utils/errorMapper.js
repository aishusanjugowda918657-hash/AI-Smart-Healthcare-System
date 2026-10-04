/**
 * Maps server API error responses and Firebase Auth error codes
 * to clear, human-readable user messages.
 */
export function mapAuthError(err) {
  if (!err) return 'An unexpected error occurred. Please try again.';

  // Response error from server API
  const serverCode = err.response?.data?.error?.code || err.response?.data?.code;
  const serverMsg = err.response?.data?.error?.message || err.response?.data?.message;

  if (serverCode === 'ACCOUNT_INCOMPLETE') {
    return 'This account was not finished. Please sign in to complete it.';
  }
  if (serverCode === 'EMAIL_IN_USE' || serverCode === 'POSSIBLE_DUPLICATE') {
    return 'This email already has an account. Sign in, or reset your password.';
  }
  if (serverCode === 'PROFILE_MISSING' || err.response?.status === 403) {
    return serverMsg || 'Profile missing, contact the administrator.';
  }
  if (err.response?.status === 401) {
    return 'Email or password is incorrect';
  }
  if (err.response?.status === 503 || serverCode === 'SERVICE_UNAVAILABLE') {
    return 'Service temporarily unavailable. Please try again in a moment.';
  }

  // Firebase Auth Error Codes
  const code = err.code || '';
  if (code.includes('email-already-in-use') || code.includes('email-already-exists')) {
    return 'This email already has an account. Sign in, or reset your password.';
  }
  if (code.includes('invalid-email')) {
    return 'Please enter a valid email address.';
  }
  if (
    code.includes('invalid-credential') ||
    code.includes('wrong-password') ||
    code.includes('user-not-found') ||
    code.includes('invalid-password')
  ) {
    return 'Email or password is incorrect';
  }
  if (code.includes('weak-password')) {
    return 'Password must be at least 6 characters long.';
  }
  if (code.includes('network-request-failed')) {
    return 'Network connection issue. Please check your internet connection.';
  }
  if (code.includes('too-many-requests')) {
    return 'Too many failed login attempts. Please try again later.';
  }

  return serverMsg || err.message || 'Authentication failed. Please check your details and try again.';
}
