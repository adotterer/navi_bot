import crypto from 'crypto';
import { getAdminByEmail, verifyPasswordFromStorage } from '../shared/adminDynamo.js';

/**
 * Admin auth: session-based login. Requires ADMIN_PASSWORD and SESSION_SECRET in env.
 * Super admin = logged in with env ADMIN_USERNAME/ADMIN_PASSWORD (only they can invite).
 */
export function requireAdmin(req, res, next) {
    if (!req.session || !req.session.admin) {
        return res.redirect('/admin/login');
    }
    if (is2faBypassed() || req.session.twoFactorVerified) return next();
    return res.redirect('/admin/2fa');
}

/** True if the current session is the super admin (env credentials). Only super admin can create new admin accounts. */
export function isSuperAdmin(req) {
    return !!(req.session && req.session.isSuperAdmin);
}

/** Require super admin; redirect to dashboard if not. Use after requireAdmin. */
export function requireSuperAdmin(req, res, next) {
    if (!req.session || !req.session.admin) return res.redirect('/admin/login');
    if (is2faBypassed() || req.session.twoFactorVerified) {
        if (isSuperAdmin(req)) return next();
    }
    return res.redirect('/admin');
}

/** When true, 2FA is skipped (non-production and SKIP_2FA_FOR_DEV=true). */
export function is2faBypassed() {
    return process.env.SKIP_2FA_FOR_DEV === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * @param {{ store?: import('express-session').Store }} opts - Optional session store (e.g. file store) to avoid MemoryStore warning.
 */
export function getSessionConfig(opts = {}) {
    const isProduction = process.env.NODE_ENV === 'production';
    const config = {
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
    if (opts.store) config.store = opts.store;
    return config;
}

/** Sync check for env super-admin only. */
export function checkLoginEnv(username, password) {
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedPass) return false;
    return username === expectedUser && password === expectedPass;
}

/**
 * Async login: try env (super admin) first, then DynamoDB admins.
 * @returns {Promise<{ ok: true, isSuperAdmin: boolean, email: string } | { ok: false }>}
 */
export async function checkLogin(username, password) {
    const u = (username && String(username).trim()) || '';
    const p = password;
    if (!p) return { ok: false };
    // 1) Super admin (env)
    if (checkLoginEnv(u, p)) {
        const email = process.env.ADMIN_EMAIL || '';
        return { ok: true, isSuperAdmin: true, email: email || u };
    }
    // 2) DynamoDB admin (login with email)
    const admin = await getAdminByEmail(u);
    if (admin && verifyPasswordFromStorage(p, admin.salt, admin.hash)) {
        return { ok: true, isSuperAdmin: false, email: admin.email };
    }
    return { ok: false };
}

export function verify2fa(session, code) {
    if (!session.twoFactorCode || !session.twoFactorExpires) return false;
    if (Date.now() > session.twoFactorExpires) return false;
    return session.twoFactorCode === code;
}

export function generate2FACode() {
    return crypto.randomInt(100000, 999999).toString();
}
