# Profile telemetry

The calendar uses GitHub GraphQL's default contribution window, including its opening week, and preserves GitHub's daily contribution levels. Counts and streaks use the returned UTC dates. Data refreshes daily and through manual workflow runs.

Top projects rank your GitHub-counted commits, pull requests, issues and reviews during the last 90 UTC calendar dates. Organization repositories are included. Only public repository names are published. The profile repository is excluded; fewer than four eligible projects produce fewer entries. Push timestamps and stars do not determine this ranking.

## Include private aggregate counts

The default Actions token may not expose all private activity. To include the owner's private aggregate counts:

1. Enable private contributions in your GitHub profile's contribution settings.
2. Create a personal access token (classic) owned by Jikugodwill with `read:user` scope and an expiration. No `repo` scope is required for this aggregate-only use.
3. In this repository's Settings → Secrets and variables → Actions, add a repository secret named `PROFILE_METRICS_TOKEN`.
4. Run **Refresh engineering telemetry** from the Actions tab.

Never place the token in a committed file. The generator verifies the token's owner and publishes no private repository names or raw API responses. Token visibility and GitHub's own contribution eligibility rules determine which activity can appear.
