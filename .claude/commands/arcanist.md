# Arcanist Agent Management

You are managing arcanist coding agents. Use the following patterns:

## Launching an Agent
```bash
arcanist create "https://github.com/shreypjain/shaadi-book.git" "<detailed prompt>" 2>&1
```
- Always include a detailed prompt with file paths to read, exact task description, branch name, and "Create a PR to main"
- Capture the session ID from output for follow-up messages
- Timeout: 30s for the create call itself (it returns immediately)

## Monitoring for PRs (Exponential Backoff)
After launching, poll for the PR with exponential backoff:
```bash
for i in 30 60 120 240; do
  sleep $i
  OPEN=$(gh pr list --repo shreypjain/shaadi-book --state open --json number,title 2>&1)
  echo "[$(date +%H:%M:%S)] PRs: $OPEN"
  if echo "$OPEN" | grep -q "number"; then echo "PR found!"; break; fi
done
```

## Nudging a Stuck Agent
```bash
arcanist message <session-id> "Please finish up and create a PR. Push your branch and use gh pr create." 2>&1
```

## Merging PRs (with conflict resolution)
1. Check mergeability: `gh pr view <N> --repo shreypjain/shaadi-book --json mergeable`
2. If MERGEABLE: `gh pr merge <N> --repo shreypjain/shaadi-book --merge --admin`
3. If CONFLICTING: rebase locally:
   ```bash
   git fetch origin && git checkout -B <branch> origin/<branch> && git rebase origin/main
   # resolve conflicts, git add, GIT_EDITOR=true git rebase --continue
   git push origin <branch> --force-with-lease
   ```
4. Always `git pull origin main` after merging to keep local in sync

## Watching a Session (real-time)
```bash
arcanist watch <session-id>   # Stream activity until idle
```

## Viewing Transcript
```bash
arcanist transcript <session-id>   # Render full session transcript
```

## Stopping a Session
```bash
arcanist stop <session-id>   # Stop the active run
```

## Checking for Updates
```bash
npm install -g arcanist@latest 2>&1
arcanist --version
```

## Key Details
- Repo URL: https://github.com/shreypjain/shaadi-book.git
- Arcanist API: https://app.tryarcanist.com
- Sessions viewable at: https://app.tryarcanist.com/sessions/<session-id>
- Always pull locally after merging: `git pull origin main`
