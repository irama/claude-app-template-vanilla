Stage all changed files and create a git commit with a conventional commit message that accurately describes what changed in this session.

Format: `type(scope): description`
Types: feat / fix / refactor / test / docs / chore / style

Steps:
1. Run `git diff --cached` and `git status` to see what changed
2. Write a commit message that captures the meaningful change (not just file names)
3. Run `git add -A` then `git commit -m "your message"`
4. Show `git log --oneline -5` to confirm

Do not push. Do not amend previous commits.
