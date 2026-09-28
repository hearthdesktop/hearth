/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Hearth contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [upstreamRef = "upstream/main", out = "changes.json"] = process.argv.slice(2);

const REPO = "https://github.com/hearthdesktop/hearth";
const GROUP_BY_TYPE = { feat: "features", fix: "fixes", perf: "fixes" };
// branding commits aren't something Hearth adds for its users
const HIDDEN_SCOPES = new Set(["brand"]);

const log = execFileSync("git", ["log", `${upstreamRef}..HEAD`, "--no-merges", "--format=%H%x1f%s%x1f%b%x1f%cI%x1e"], {
    encoding: "utf8"
});

const commits = log
    .split("\x1e")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
        const [sha, subject, body, date] = entry.split("\x1f");
        return { sha, subject, body, date };
    });

const reverted = commits.flatMap(c => [...c.body.matchAll(/This reverts (?:commit )?([0-9a-f]{7,40})/g)].map(m => m[1]));
const isReverted = sha => reverted.some(prefix => sha.startsWith(prefix));

const result = {
    generatedAt: new Date().toISOString(),
    upstream: "Vencord/Vesktop",
    commitsAhead: commits.length,
    features: [],
    fixes: []
};

for (const commit of commits) {
    const match = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/.exec(commit.subject);
    if (!match || isReverted(commit.sha)) continue;

    const [, type, scope = "", summary] = match;
    const group = GROUP_BY_TYPE[type];
    if (!group || HIDDEN_SCOPES.has(scope)) continue;

    result[group].push({
        sha: commit.sha,
        scope,
        summary: summary[0].toUpperCase() + summary.slice(1),
        date: commit.date,
        url: `${REPO}/commit/${commit.sha}`
    });
}

writeFileSync(out, JSON.stringify(result, null, 4) + "\n");
console.log(`${result.features.length} features, ${result.fixes.length} fixes, ${commits.length} commits ahead of ${upstreamRef}`);
