import crypto from 'crypto';

/**
 * Admin auth: session-based login. Requires ADMIN_PASSWORD and SESSION_SECRET in env.
 */
export function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) {
        const skip2fa = process.env.SKIP_2FA_FOR_DEV === 'true' && process.env.NODE_ENV !== 'production';
        if (skip2fa || req.session.twoFactorVerified) return next();
        return res.redirect('/admin/2fa');
    }
    res.redirect('/admin/login');
}

export function getSessionConfig() {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        secret: process.env.SESSION_SECRET || 'change-me-in-production',
        resave: false,
        saveUninitialized: false,
        name: 'navi.admin.sid',
        cookie: {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000, // 8 hours
        },
    };
}

export function checkLogin(username, password) {
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedPass) return false;
    return username === expectedUser && password === expectedPass;
}

export function verify2fa(session, code) {
    if (!session.twoFactorCode || !session.twoFactorExpires) return false;
    if (Date.now() > session.twoFactorExpires) return false;
    return session.twoFactorCode === code;
}

export function generate2FACode() {
    return crypto.randomInt(100000, 999999).toString();
}

export function shouldSkip2FA() {
    return process.env.SKIP_2FA_FOR_DEV === 'true' && process.env.NODE_ENV !== 'production';
}

export function is2faBypassed() {
    return process.env.SKIP_2FA_FOR_DEV === 'true' && process.env.NODE_ENV !== 'production';
}
