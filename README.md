# github-star-organizer

## How to Run the Script

1. Install dependencies

```bash
bun install
```

2. Run the script

```bash
bun run ./src/app.ts
```

## How to Generate a GitHub Personal Access Token

1. Log in to your GitHub account.
2. Click on your profile picture in the top right corner, then select **Settings**.
3. In the left sidebar, scroll down and select **Developer settings**.
4. Click on **Personal access tokens**.
5. Select **Tokens (classic)**.
6. Click the **Generate new token** button and select **Generate new token (classic)**.
7. Give your token a descriptive name in the "Note" field (e.g., "github-star-organizer").
8. Set an expiration period according to your preference.
9. In the "Select scopes" section, check at least:
  - `repo` (full access to repositories)
  - `read:user` (read access to user data)
10. Scroll down and click the **Generate token** button.
11. **IMPORTANT**: Copy the generated token and save it in a secure location. GitHub will only show it once!
12. Paste the copied token as the `GITHUB_TOKEN` value in your `.env` file.

## How to Get a Claude API Key

1. Register on the [Anthropic](https://www.anthropic.com/) website.
2. Navigate to the developer tools section or API dashboard.
3. Generate your API Key.
4. Add the key as the `CLAUDE_API_KEY` value in your `.env` file.