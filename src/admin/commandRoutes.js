import express from 'express';
import { requireAdmin } from './auth.js';
import { adminHead, adminNav, adminContainer } from './layout.js';

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
    res.send(`
${adminHead('Commands')}
${adminNav('commands')}
${adminContainer(`
    <h1>Commands</h1>
    <table class="admin-table">
        <thead>
            <tr>
                <th>Command</th>
                <th>Aliases</th>
                <th>Description</th>
                <th>Works In</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><code>!mu</code></td>
                <td><code>!mu-notes</code></td>
                <td>Generate full matchup summary for a character</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!mq</code></td>
                <td><code>!mu-question, !mu-q, !muq</code></td>
                <td>Ask a specific matchup question</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!q</code></td>
                <td>none</td>
                <td>General question using glossary and fundamentals</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!sq</code></td>
                <td>none</td>
                <td>Stats question</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!fd</code></td>
                <td>none</td>
                <td>Frame data lookup for a move</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!fdq</code></td>
                <td>none</td>
                <td>Frame data question (AI-powered)</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!export</code></td>
                <td>none</td>
                <td>Export channel messages to S3</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!cleanup</code></td>
                <td><code>!cleanupall</code></td>
                <td>Delete bot messages in channel</td>
                <td>Any channel</td>
            </tr>
            <tr>
                <td><code>!stats</code></td>
                <td><code>!s</code></td>
                <td>Character stats lookup</td>
                <td>Any channel</td>
            </tr>
        </tbody>
    </table>
`)}
    `);
});

export default router;