/**
 * Admin routes for uploading assets (images, etc.) to S3. Uses same S3 pipeline as the rest of the app.
 */
import express from 'express';
import path from 'path';
import { uploadBufferToS3, listAllS3KeysWithPrefix, deleteFromS3 } from '../shared/s3Helper.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';
import { generateCsrfToken } from './csrf.js';

/** All uploads go under this prefix in the bucket (keeps assets separate from JSON etc.). */
const ASSETS_PREFIX = 'assets/';

/** Sanitize key for delete: only allow keys under ASSETS_PREFIX (safe chars). */
function sanitizeKeyForDelete(raw) {
    if (typeof raw !== 'string') return '';
    const k = raw.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/').trim();
    if (!k || /\.\.|[^a-zA-Z0-9/._-]/.test(k)) return '';
    if (!k.startsWith(ASSETS_PREFIX)) return '';
    return k;
}

const router = express.Router();

const EXT_TO_CONTENT_TYPE = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
};

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
}

/** Sanitize prefix: only allow alphanumeric, hyphen, underscore, slash. */
function sanitizePrefix(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '') || '';
}

/** Sanitize object key segment (filename): remove path separators and dangerous chars. */
function sanitizeKeySegment(name) {
    if (typeof name !== 'string') return 'upload';
    const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    return base || 'upload';
}

router.get('/', async (req, res) => {
    const csrfToken = generateCsrfToken(req, res);
    const csrfInput = `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`;
    const deleted = req.query.deleted === '1';
    // Success message from session flash (avoids long URLs and dropped query params)
    const uploadedKeysFromSession = req.session && req.session.assetsUploaded ? req.session.assetsUploaded : [];
    const showUploadSuccess = req.query.uploaded === '1' && uploadedKeysFromSession.length > 0;
    if (showUploadSuccess && req.session) {
        delete req.session.assetsUploaded;
    }
    const urls = uploadedKeysFromSession;
    const successHtml = (showUploadSuccess && urls.length > 0)
        ? `<div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm px-4 py-3 mb-6">
  <p class="font-medium mb-2">Uploaded ${urls.length} file(s).</p>
  <ul class="space-y-1 font-mono text-xs break-all">${urls.map((k) => {
          const path = (typeof k === 'string' && k.startsWith(ASSETS_PREFIX)) ? k.slice(ASSETS_PREFIX.length) : k;
          const href = '/assets/' + path;
          return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="text-emerald-700 dark:text-emerald-400 hover:underline">${escapeHtml(href)}</a></li>`;
      }).join('')}</ul>
</div>`
        : (req.query.uploaded === '1'
            ? '<div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm px-4 py-3 mb-6">Upload complete. Your assets are listed below.</div>'
            : '');
    const saveSessionThenSend = (html) => {
        if (showUploadSuccess && req.session) {
            return req.session.save((err) => {
                if (err) console.error('[assets] session save', err);
                res.send(html);
            });
        }
        res.send(html);
    };
    const deletedHtml = deleted
        ? '<div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm px-4 py-3 mb-6">Asset deleted.</div>'
        : '';
    const errorMsg = req.query.error ? decodeURIComponent(String(req.query.error)) : '';
    const errorHtml = errorMsg
        ? `<div class="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-sm px-4 py-3 mb-6">${escapeHtml(errorMsg)}</div>`
        : '';

    let listHtml = '';
    try {
        const allKeys = await listAllS3KeysWithPrefix(ASSETS_PREFIX, 5000);
        const keys = allKeys.sort((a, b) => (a.Key || '').localeCompare(b.Key || ''));
        const imageExt = /\.(png|jpe?g|gif|webp|svg)$/i;
        listHtml = keys.length === 0
            ? '<p class="text-slate-500 dark:text-slate-400 text-sm">No assets yet. Upload files above. All uploads go to the <code class="bg-slate-100 dark:bg-slate-700 px-1 rounded">assets/</code> folder in the bucket.</p>'
            : `
    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <table class="w-full text-sm">
        <thead><tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
          <th class="text-left py-3 px-3 w-16">Preview</th>
          <th class="text-left py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">Key</th>
          <th class="text-left py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">Size</th>
          <th class="w-24"></th>
        </tr></thead>
        <tbody>
          ${keys.map((e) => {
              const key = e.Key || '';
              const pathAfterPrefix = key.startsWith(ASSETS_PREFIX) ? key.slice(ASSETS_PREFIX.length) : key;
              const viewUrl = `/assets/${pathAfterPrefix}`;
              const isImg = imageExt.test(key);
              const preview = isImg
                  ? `<a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener" class="block w-12 h-12 rounded border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-700"><img src="${escapeHtml(viewUrl)}" alt="" class="w-full h-full object-contain" loading="lazy" onerror="this.parentElement.innerHTML='—'"></a>`
                  : '<span class="text-slate-400">—</span>';
              const size = e.Size != null ? (e.Size < 1024 ? e.Size + ' B' : (e.Size < 1024 * 1024 ? (e.Size / 1024).toFixed(1) + ' KB' : (e.Size / (1024 * 1024)).toFixed(1) + ' MB')) : '—';
              return `<tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                <td class="py-2 px-3 align-middle">${preview}</td>
                <td class="py-2 px-3 font-mono text-xs break-all"><a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener" class="text-emerald-600 dark:text-emerald-400 hover:underline">${escapeHtml(pathAfterPrefix)}</a></td>
                <td class="py-2 px-3 text-slate-500 dark:text-slate-400">${escapeHtml(size)}</td>
                <td class="py-2 px-3">
                  <form method="post" action="/admin/assets/delete" class="inline" onsubmit="return confirm('Delete this asset?');">
                    ${csrfInput}
                    <input type="hidden" name="key" value="${escapeHtml(key)}">
                    <button type="submit" class="text-sm text-red-600 dark:text-red-400 hover:underline">Delete</button>
                  </form>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
    } catch (err) {
        console.error('[assets] list', err.message || err);
        listHtml = '<p class="text-amber-600 dark:text-amber-400 text-sm">Could not list assets. Check S3 credentials and bucket.</p>';
    }

    const content = `
  ${adminNav('assets')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Assets' }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mt-2">Upload assets to S3</h1>
    <p class="text-slate-600 dark:text-slate-400 text-sm mb-6">Upload images or other files to the <code class="bg-slate-100 dark:bg-slate-700 px-1 rounded">assets/</code> folder in the S3 bucket (keeps them separate from other data). Max 10 MB per file.</p>
    ${successHtml}
    ${deletedHtml}
    ${errorHtml}
    <form id="asset-upload-form" method="post" action="/admin/assets" enctype="multipart/form-data" class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4 mb-8">
      ${csrfInput}
      <div>
        <label for="prefix" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Subfolder under assets/ (optional)</label>
        <input type="text" id="prefix" name="prefix" placeholder="e.g. stage-lists"
          class="w-full max-w-md rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Enter just the subfolder name (no slashes). Leave blank for <code class="bg-slate-100 dark:bg-slate-700 px-1 rounded">assets/filename</code>; use <code class="bg-slate-100 dark:bg-slate-700 px-1 rounded">stage-lists</code> for <code class="bg-slate-100 dark:bg-slate-700 px-1 rounded">assets/stage-lists/filename</code>.</p>
      </div>
      <div>
        <label for="assets" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Files</label>
        <input type="file" id="assets" name="assets" multiple accept="image/*,.pdf"
          class="w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 dark:file:bg-emerald-900/30 dark:file:text-emerald-300 hover:file:bg-emerald-100 dark:hover:file:bg-emerald-900/50" />
      </div>
      <div id="upload-status" class="hidden flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2" aria-live="polite">
        <svg class="animate-spin h-5 w-5 text-emerald-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Uploading…</span>
      </div>
      <button type="submit" id="asset-upload-btn" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 text-sm hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors disabled:opacity-70 disabled:pointer-events-none inline-flex items-center gap-2">
        <span id="asset-upload-btn-text">Upload</span>
      </button>
    </form>
    <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Uploaded assets</h2>
    ${listHtml}
  `)}
`;
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Assets')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}
<script>
(function(){
  var form = document.getElementById('asset-upload-form');
  var btn = document.getElementById('asset-upload-btn');
  var status = document.getElementById('upload-status');
  if (!form || !btn || !status) return;
  form.addEventListener('submit', function(){
    status.classList.remove('hidden');
    status.classList.add('flex');
    btn.disabled = true;
    var textEl = document.getElementById('asset-upload-btn-text');
    if (textEl) textEl.textContent = 'Uploading…';
  });
})();
</script>
</body>
</html>`;
    saveSessionThenSend(fullHtml);
});

router.post('/', async (req, res, next) => {
    try {
        const files = req.files && Array.isArray(req.files) ? req.files : [];
        const prefixRaw = (req.body && req.body.prefix) ? String(req.body.prefix).trim() : '';
        const prefix = sanitizePrefix(prefixRaw);
        const subPath = prefix ? prefix + '/' : '';

        if (files.length === 0) {
            return res.redirect('/admin/assets?error=' + encodeURIComponent('No files selected.'));
        }

        const uploadedKeys = [];
        let firstError = null;

        for (const file of files) {
            const safeName = sanitizeKeySegment(file.originalname || file.name);
            const key = ASSETS_PREFIX + subPath + safeName;
            const contentType = getContentType(file.originalname || file.name);
            try {
                await uploadBufferToS3(key, file.buffer, contentType);
                uploadedKeys.push(key);
            } catch (err) {
                if (!firstError) firstError = err;
            }
        }

        if (firstError && uploadedKeys.length === 0) {
            return res.redirect('/admin/assets?error=' + encodeURIComponent(firstError.message || 'Upload failed.'));
        }

        req.session.assetsUploaded = uploadedKeys;
        req.session.save((err) => {
            if (err) {
                console.error('[assets] session save after upload', err);
                return res.redirect('/admin/assets?uploaded=1');
            }
            res.redirect(303, '/admin/assets?uploaded=1');
        });
    } catch (err) {
        next(err);
    }
});

router.post('/delete', express.urlencoded({ extended: true }), async (req, res) => {
    const key = sanitizeKeyForDelete(req.body && req.body.key);
    if (!key) {
        return res.redirect('/admin/assets?error=' + encodeURIComponent('Invalid or disallowed key.'));
    }
    try {
        await deleteFromS3(key);
        return res.redirect('/admin/assets?deleted=1');
    } catch (err) {
        console.error('[assets] delete', key, err.message || err);
        return res.redirect('/admin/assets?error=' + encodeURIComponent(err.message || 'Delete failed.'));
    }
});

export default router;
