# GitHub Repository Setup Instructions

## Step 1: Create Repository on GitHub

1. Go to https://github.com/new
2. Fill in details:
   - **Repository name:** `hermes-virtual-office`
   - **Description:** Real-time visualization & coordination system for autonomous AI agents
   - **Visibility:** `Private` (as requested)
   - **Initialize:** Leave unchecked (we have initial commit locally)

3. Click **Create repository**

4. Copy the HTTPS URL (should be: `https://github.com/fajargumelar/hermes-virtual-office.git`)

## Step 2: Push Local Repository

```bash
cd /Users/fajargumelar/hermes-virtual-office

# Add GitHub as remote
git remote add origin https://github.com/fajargumelar/hermes-virtual-office.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

## Step 3: Verify on GitHub

- Check: https://github.com/fajargumelar/hermes-virtual-office
- Should show:
  - ✅ Initial commit visible
  - ✅ All files present
  - ✅ README rendered

## Step 4: Create GitHub Project (Optional but Recommended)

1. Go to repository → **Projects** tab
2. Click **Create new project**
3. Project name: `Sprint 1: Infrastructure Setup`
4. Template: **Table**
5. Create columns: `Backlog | Ready | In Progress | Review | Done`
6. Close this for now (we'll populate in next step)

## Step 5: GitHub Actions CI/CD Setup (Phase 1)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: test_password
          POSTGRES_DB: hvo_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies (backend)
        run: npm ci
        working-directory: ./backend

      - name: Lint backend
        run: npm run lint
        working-directory: ./backend
        continue-on-error: true

      - name: Build backend
        run: npm run build
        working-directory: ./backend
        continue-on-error: true
```

(Full workflows created after backend scaffolding)

---

## Troubleshooting

**Error: "fatal: 'origin' already exists"**
```bash
git remote remove origin
git remote add origin https://github.com/fajargumelar/hermes-virtual-office.git
```

**Error: "Permission denied (publickey)"**
- Ensure GitHub SSH key is configured
- Or use HTTPS with personal access token (GitHub → Settings → Developer Settings → Tokens)

---

**Status:** ✅ Ready for next step (backend scaffolding)

**Next Command After Push:**
```bash
cd /Users/fajargumelar/hermes-virtual-office
nest new backend --package-manager npm
```

See SETUP.md for backend initialization details.
