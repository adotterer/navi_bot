import express from 'express';
import { requireAdmin } from './auth.js';
import { adminHead, adminNav, adminContainer } from './layout.js';

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
    const nonce = res.locals.nonce || '';
    const content = `
  ${adminNav('commands', false, nonce)}
  ${adminContainer(`
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Commands</h1>
    <div class="overflow-x-auto">
      <table class="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-800 text-left text-slate-600 dark:text-slate-400 font-medium">
            <th class="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Command</th>
            <th class="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Aliases</th>
            <th class="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Description</th>
            <th class="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Works In</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
          <!-- Query Commands -->
          <tr class="bg-blue-50 dark:bg-blue-900/20">
            <td colspan="4" class="px-4 py-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
              🔍 Query Commands
            </td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!mu</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400"><code class="font-mono">!mu-notes</code></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Generate full matchup summary for a character</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!mq</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!mu-question, !mu-q, !muq</code></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Ask a specific matchup question</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!q</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">General question using glossary and fundamentals</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!sq</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Stats question</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!fd</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Frame data lookup for a move</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!fdq</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Frame data question (AI-powered)</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!gt</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">General tips for your character vs opponent (e.g. <code class="font-mono">!gt mario falco</code>; MU thread + frame data and OoS)</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">ask-navi or Mod/Legend</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!sl</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Show stage lists used in the game</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>


          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!listthreads</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">List threads for data maintenance</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Moderator/Legend only</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!stats</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!s</code></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Character stats lookup</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!docs</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Show documentation and help</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!faq</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Show frequently asked questions</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!aliases</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Show character aliases and names</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!canonical</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Show canonical character threads</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <!-- Slash commands: Stage ban -->
          <tr class="bg-green-50 dark:bg-green-900/20">
            <td colspan="4" class="px-4 py-2 text-sm font-semibold text-green-800 dark:text-green-200">
              Slash commands (stage ban)
            </td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/coinflip</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Start a stage ban match; opponent required; 24h expiry</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/bo3</code>, <code class="text-emerald-700 dark:text-emerald-400 font-mono">/bo5</code>, <code class="text-emerald-700 dark:text-emerald-400 font-mono">/ft5</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Start a match with set format (first to 2 / 3 / 5); opponent required</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/ban</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Ban or select a stage (dropdown or this command; stage name or alias, match_id optional)</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/result</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Report who won a game (loser confirms); use after Game 1 or Game 2+</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/end</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">End the stage ban session (either player)</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">/cancel-match</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Cancel your active stage ban match (either player)</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <!-- Admin/Mod Tools -->
          <tr class="bg-amber-50 dark:bg-amber-900/20">
            <td colspan="4" class="px-4 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
              🛠️ Admin/Mod Tools
            </td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!add-a</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400"><code class="font-mono">!add-alias</code></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Add new aliases</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Moderator/Legend only</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!modhelp</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">helps them remember what the mod commands are by sending an embed message with the commands available to mods only.</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Moderator/Legend only</td>
          </tr>

          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!addzelda</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Add Zelda player for tournament tracking</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!listzelda</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">List tracked Zelda players</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!export</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Export channel messages to S3</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!cleanup</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!cleanupall</code></td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Delete bot messages (!cleanup) or all messages (!cleanupall) in #ask-navi</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Moderator/Legend only</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!list-thread-counts</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">List thread counts for export</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!ts</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Test tournament notification scheduler</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono">!logs</code></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Last 100 lines of system log</td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Moderator/Legend only</td>
          </tr>
          <!-- Passive Triggers -->
          <tr class="bg-purple-50 dark:bg-purple-900/20">
            <td colspan="4" class="px-4 py-2 text-sm font-semibold text-purple-800 dark:text-purple-200">
              🔔 Passive Triggers
            </td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><span class="text-slate-600 dark:text-slate-400 font-mono">"should have"</span></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">Auto-corrects "should have" to "could have" <span class="inline-block bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded text-xs font-medium ml-2">Passive</span></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="px-4 py-3"><span class="text-slate-600 dark:text-slate-400 font-mono">"arena is up"</span></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">—</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-300">LAN warning for arena announcements <span class="inline-block bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded text-xs font-medium ml-2">Passive</span></td>
            <td class="px-4 py-3 text-slate-500 dark:text-slate-400">Any channel</td>
          </tr>
        </tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Commands', nonce)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

export { router as commandRoutes };
