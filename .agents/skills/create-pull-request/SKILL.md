---
name: create-pull-request
description: Use when a user asks to create, open, publish, or update a pull request, especially when using CLI commands that bypass repository templates.
---

# Create Pull Request

Create an evidence-backed PR without duplicating or drifting from the repository's canonical template.

## Workflow

1. Read `AGENTS.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `feature_list.json`, and `progress.md` before drafting the PR.
2. Confirm the requested changes are on an appropriate branch and inspect the complete diff against the intended base branch. Preserve unrelated user changes.
3. Run the applicable verification documented by the repository. Record exact commands and results, plus anything not verified. Do not infer passing results.
4. Build and validate the title using the single canonical title convention in the root agent instructions. Do not invent or maintain an alternate convention in this skill.
5. Build the body from `.github/PULL_REQUEST_TEMPLATE.md` exactly:
   - Keep every section in the same order.
   - Replace instructional comments with concrete, checkable content.
   - Use `Not applicable` with a reason when a section genuinely does not apply.
   - Preserve the template footer.
   - Do not maintain a second copy of the template in this skill.
6. Before any commit, push, or GitHub mutation, confirm the user's request authorizes that action. Never merge a PR unless the user explicitly asks.
7. Create or update the PR with GitHub CLI using the validated title and a UTF-8 body file so Markdown is preserved. Do not compose a shorter body from memory or pass it inline.
8. Verify the published result with `gh pr view --json url,state,baseRefName,headRefName,title,body` and confirm that the published title still follows the root agent instructions and the remote head SHA matches the intended local commit.
9. Report the PR URL, branch, verification results, and any known gaps.

## Quality Gate

- Every template section is present and contains concrete content or a justified `Not applicable` statement.
- The PR title follows the canonical convention in the root agent instructions exactly.
- Every body claim points to a file, test, log, issue, or reproducible check.
- Test counts and baseline differences are accurate.
- Manual UI instructions assume a non-technical reviewer with UI-only access. Use plain-language routes, visible labels, actions, prerequisites, expected results, and negative checks; never require source code, terminals, APIs, developer tools, logs, databases, cloud consoles, or deployment access.
- The published body matches the generated body file and the remote head SHA matches the intended local commit.
