/** Access gates for /zelda/*, reusing the same express-session instance wired in app.js. */

export function requireSiteAuth(req, res, next) {
    if (req.session?.hasCoachingPass) return next();
    return res.redirect('/zelda/login?next=' + encodeURIComponent(req.originalUrl));
}

export function requireModOrLegend(req, res, next) {
    if (req.session?.isModOrLegend) return next();
    return res.status(403).send('Moderators/Legend only.');
}

export function checkRecruiterPassword(password) {
    return !!process.env.RECRUITER_PASSWORD && password === process.env.RECRUITER_PASSWORD;
}
