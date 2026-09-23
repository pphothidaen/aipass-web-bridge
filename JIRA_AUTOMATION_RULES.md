# 📊 Jira Automation Rules — Configuration Guide

> **Purpose:** Sync Jira ticket status automatically when code events occur (no Hermes cron needed)
> **Platform:** Jira Cloud (pansakorn.atlassian.net)
> **Method:** Native Jira Automation (Project Settings → Automation)

---

## Rule 1: Commit Pushed → Add Comment to Ticket

**Trigger:** Incoming webhook (or GitHub integration)
**Filter:** Entity type = Pull request, Action = Created

```yaml
Name: "Commit → Jira Comment"
Trigger: Incoming webhook (or GitHub integration)
Filter: Entity type = Pull request, Action = Created
Action: Add comment to issue
Comment: "{{trigger.author.displayName}} pushed {{trigger.commits.size}} commit(s) on {{trigger.ref}}"
```

*Note: Configure webhook to point to `https://api.atlassian.com/...` or use native GitHub-Jira integration*

---

## Rule 2: PR Opened → Move to Review

**Trigger:** Incoming webhook — PR opened
**Filter:** Pull request → Created

```yaml
Name: "PR Opened → Review"
Trigger: Incoming webhook (GitHub → Jira app)
Filter:
  - Entity type: Pull request
  - Action: Created
Transition: Move issue to status "Review"
Comment: "{{author.displayName}} opened PR: {{pullRequest.url}}"
```

---

## Rule 3: PR Merged → Move to Done

**Trigger:** Incoming webhook — PR merged
**Filter:** Pull request → Merged

```yaml
Name: "PR Merged → Done"
Trigger: Incoming webhook
Filter:
  - Entity type: Pull request
  - Action: Merged
Transition: Move issue to status "Done"
Comment: "PR merged by {{author.displayName}}"
```

---

## Rule 4: Branch Created → Move to In Progress

**Trigger:** Incoming webhook — Branch created
**Filter:** Branch → Created, Branch name contains `KAN-`

```yaml
Name: "Branch Created → In Progress"
Trigger: Incoming webhook
Filter:
  - Entity type: Branch
  - Action: Created
  - Branch name matches regex: "KAN-\d+"
Transition: Move issue to status "In Progress"
```

---

## Rule 5: CI Fails → Back to TDD RED

**Trigger:** Incoming webhook — CI failed
**Filter:** All check runs → Completed, Conclusion = Failed

```yaml
Name: "CI Failed → TDD RED"
Trigger: Incoming webhook
Filter:
  - Entity type: Check run
  - Conclusion: Failed
Transition: Move issue to status "TDD RED"
Comment: "🔴 CI failed — check run {{checkRun.name}}"
```

---

## Rule 6: Orphan Epic Detection (Scheduled)

**Trigger:** Scheduled — Daily at 09:00
**JQL Filter:** `project = KAN AND issuetype = Epic AND issue in updated(-7d) AND issuesCount = 0`

```yaml
Name: "Orphan Epic Alert"
Trigger: Scheduled — Daily
JQL: project = KAN AND issuetype = Epic AND updated < -7d AND issuesCount = 0
Action: Send email to assignee + Hermes
Comment: "⚠️ This Epic has no Stories linked for 7+ days."
```

---

## Rule 7: Stale In-Progress Detection

**Trigger:** Scheduled — Every 4 hours
**JQL Filter:** `status = "In Progress" AND updated < -24h`

```yaml
Name: "Stale In-Progress Alert"
Trigger: Scheduled — Every 4 hours
JQL: project = KAN AND status = "In Progress" AND updated < -24h
Action: Send comment to issue
Comment: "⏰ This ticket has been In Progress for 24h without update."
```

---

## Implementation Notes

### Using Native GitHub-Jira Integration (Recommended)

1. Install [GitHub for Jira](https://marketplace.atlassian.com/apps/1219592/github-for-jira) app
2. Connect your GitHub account
3. Smart commits work automatically:
   - `KAN-123 #comment Fixed the bug` → adds comment
   - `KAN-123 #time 2h 30m` → logs work
   - `KAN-123 #close` → transitions to Done

### Using Webhooks (If Self-Hosted)

1. Create webhook in GitHub repo: Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain.atlassian.net/rest/webhook`
3. Events: Pull requests, Pushes, Check runs

### Jira Automation API Limitations (Verified 2026-09-23)

| Feature | API Support | Alternative |
|---------|-------------|-------------|
| Create/Read Custom Status | ✅ Full | Direct API |
| Create/Read Custom Fields | ✅ Full | Direct API |
| Create/Read Transitions | ✅ Full | Direct API |
| **Automation Rules** | ❌ 404 (requires Premium) | **Manual UI setup** OR **Hermes cron** |
| **Scheduled Triggers** | ❌ Not in Free/Standard API | **Hermes cron** fallback |

### Verified API Endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /rest/api/3/project/{key}` | ✅ | Project info |
| `GET /rest/api/3/status` | ✅ | All statuses |
| `POST /rest/api/3/search/jql` | ✅ | Issue search (new endpoint per CHANGE-2046) |
| `GET /rest/api/3/issue/{id}` | ✅ | Issue detail |
| `POST /rest/api/3/issue/{id}/comment` | ✅ | Add comment |
| `GET /rest/api/3/issue/{id}/transitions` | ✅ | Get transitions |
| `POST /rest/api/3/issue/{id}/transitions` | ✅ | Execute transition |
| `POST /rest/api/3/issue` | ✅ | Create issue |
| `POST /rest/api/3/status` | ✅ | Create status |
| `POST /rest/api/3/field` | ✅ | Create custom field |
| `GET /rest/automation/1.0/rules` | ❌ 404 | **Not available** in current plan |

### Recommendation

**For Automation Rules (6 rules):** Configure manually via UI following the patterns above.
**For Scheduled Detection (orphan epic, stale tickets):** Use Hermes cron with `scripts/jira_orchestrator.py` as fallback polling.

---

## Setup Checklist

- [ ] Enable GitHub-Jira integration (install app)
- [ ] Configure 7 automation rules above
- [ ] Add Jira secrets to GitHub repo:
  - `JIRA_BASE_URL`
  - `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
- [ ] Install local hooks:
  - `post-commit` → push commit info to Jira
  - `pre-push` → validate atomic execution
  - `prepare-commit-msg` → enforce Jira key in message
- [ ] Test with a sample commit + PR
