/**
 * CSRF protection for admin forms (double-submit cookie pattern).
 * Use doubleCsrfProtection before admin routes; add _csrf hidden input to all POST forms.
 */
import { doubleCsrf } from 'csrf-csrf';

const secret = () => process.env.SESSION_SECRET || 'change-me-in-production';

const isProduction = process.env.NODE_ENV === 'production';

const {
    doubleCsrfProtection,
    generateCsrfToken,
} = doubleCsrf({
    getSecret: secret,
    getSessionIdentifier: (req) => req.session?.id ?? req.ip ?? 'anon',
    cookieName: 'navi_admin_csrf',
    cookieOptions: {
        sameSite: 'lax',
        path: '/admin',
        secure: isProduction,
        httpOnly: true,
    },
    getCsrfTokenFromRequest: (req) => {
        if (req.body && typeof req.body._csrf === 'string') return req.body._csrf;
        return req.headers['x-csrf-token'];
    },
    // Skip CSRF validation in development so login works on localhost without cookie/session quirks.
    skipCsrfProtection: () => !isProduction,
});

export { doubleCsrfProtection, generateCsrfToken };
