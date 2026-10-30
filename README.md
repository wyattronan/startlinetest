# Startline on Netlify

## What's in here

- `public/index.html` is the Startline site.
- `public/claude-shim.js` connects the page's AI features to your own server instead of claude.ai.
- `netlify/edge-functions/ai.js` is a small server function. It holds your Anthropic API key and streams the coach's answers back to the page.
- `public/ai-check.html` tests the AI connection step by step and tells you what to fix. Open `yoursite.netlify.app/ai-check.html`.
- `netlify.toml` tells Netlify to publish `public/`.

## Deploy (about 10 minutes)

1. **Get an Anthropic API key** at console.anthropic.com. Add a payment method and set a monthly spend limit there.
2. **Put this folder on GitHub.**
   - Create a new private repo.
   - Choose "uploading an existing file".
   - Drag in everything inside this folder: `public`, `netlify`, `netlify.toml` and this README.
3. **Connect it in Netlify.**
   - Go to Add new site → Import an existing project → GitHub, then pick the repo.
   - Leave the build command empty. The publish directory reads `public` from netlify.toml.
4. **Add your key.**
   - Go to Site configuration → Environment variables.
   - Add `ANTHROPIC_API_KEY` = your key.
5. **Redeploy** under Deploys → Trigger deploy. New variables only take effect after a fresh deploy.
6. **Check it.** Open `/ai-check.html` on your site. All five rows should be green. Then upload a resume.

Drag-and-drop deploys (Netlify Drop) publish only static files, so the AI function won't run that way. Use GitHub, or run `npx netlify-cli deploy --prod` from this folder.

## If the coach "couldn't be reached"

Open `/ai-check.html`. The first red row is the problem, and the page explains the fix. The common causes:

- **"The AI function is deployed" fails.** The site was deployed by drag-and-drop, or `netlify.toml` and the `netlify` folder aren't at the top level of the repo.
- **"API key is set" fails.** `ANTHROPIC_API_KEY` is missing, or the site wasn't redeployed after you added it.
- **"Anthropic accepted a test request" fails.** The key is wrong, the account has no credits, or the account can't use the model.

## Optional settings (environment variables)

- `MODEL` sets the main model. Default: `claude-sonnet-5-5`.
- `MODEL_QUICK` sets the model for quick rewrites. Default: `claude-haiku-5-5`.
- `ALLOWED_ORIGINS` is a comma-separated list of extra domains allowed to call the AI, e.g. `https://startline.us`. Your Netlify domain is always allowed, and so is a custom domain on the same site.

## What works and what doesn't yet

**Works:**
- Resume upload and scoring
- Red Pen Workshop and the Word export
- Career vision
- Path questions
- Next race, including the weekly plan, interview prep and cold pitches
- Profile
- About page
- Dark mode

**Saves in the visitor's browser only.** Progress stays on one device, and clearing browser data erases it.

**Not connected yet:**
- **Sign-in** (Google, etc.)
- **Cross-device saving**
- **The resume backlog.** Uploaded resumes are not stored anywhere on this version.

All three need an auth and database service such as Supabase or Firebase.

## Costs

On claude.ai, each visitor's AI use counted against their own Claude account. On your site, every call bills your API key. A full run (score, red pen, vision, path, prep) is a dozen or more calls. Set a spend limit in the Anthropic console before you share the link.
