---
name: git
description: Commit and push all changes. Use when the user says "commit", "push", "commit and push", or invokes /git.
---

Commit and push all changes in the current repository.

Steps:

1. Run `git status` and `git diff` (staged + unstaged) in parallel to see what has changed.
2. Run `git log -5 --oneline` to check the recent commit style for this repo.
3. Stage all changed/new files relevant to the work (prefer specific file names over `git add -A` to avoid accidentally including secrets or unrelated files).
4. Write a concise commit message that focuses on _why_, not just what. End the message with:
   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
5. Commit, then `git push`.
6. Confirm success with a final `git status`.

If there is nothing to commit, say so clearly — do not create an empty commit.
