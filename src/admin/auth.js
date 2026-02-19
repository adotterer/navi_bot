/**
 * Admin auth: session-based login. Requires ADMIN_PASSWORD and SESSION_SECRET in env.
 */
export function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    res.redirect('/admin/login');
}

export function getSessionConfig() {
    return {
        secret: process.env.SESSION_SECRET || 'change-me-in-production',
        resave: false,
        saveUninitialized: false,
        name: 'navi.admin.sid',
    };
}

export function checkLogin(username, password) {
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedPass) return false;
    return username === expectedUser && password === expectedPass;
}
