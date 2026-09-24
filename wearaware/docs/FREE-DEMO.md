# Free demo: Vercel frontend and local services

The Vercel CLI can upload the current frontend directly. A Git commit or push is not required. Run commands from the `wearaware` directory containing `index.html` and `vercel.json`.

The configured demo project is `wearaware-demo`, with the public website at https://wearaware-demo.vercel.app. Its frontend is deployed; the API, AI, and database still run locally. The Vercel configuration explicitly declares only the frontend service so the CLI does not deploy the Python model it discovers in this repository.

## 1. Connect your Vercel account

Create a personal Hobby account at https://vercel.com/signup, then run:

```sh
npx --yes vercel login
```

Complete the browser sign-in. Keep account credentials and login codes private.

## 2. Run local services

If MongoDB is not running:

```sh
npm --prefix src/wearawarebackend run db:local
```

Start the backend and AI service in separate terminals, skipping services already running:

```sh
npm --prefix src/wearawarebackend start
```

```sh
"$HOME/Desktop/testppedetect/.venv/bin/python" -m uvicorn api:app --app-dir services/ppe-api --host 127.0.0.1 --port 8000
```

This demo retains the local backend environment and local MongoDB. Do not set `NODE_ENV=production` on this local setup: production mode deliberately requires authenticated, TLS-protected MongoDB and separately configured proxy settings.

## 3. Start the temporary backend tunnel

Cloudflared is installed with `brew install cloudflared`. Run:

```sh
cloudflared tunnel --url http://127.0.0.1:5000
```

Keep this terminal open. Copy its `https://...trycloudflare.com` URL. Tunnel only the backend; MongoDB and the AI service do not need public URLs.

## 4. Deploy the frontend

Replace the example below with the actual tunnel URL, without `/api` or a trailing slash:

```sh
npx --yes vercel --prod --build-env VITE_API_ORIGIN=https://YOUR-TUNNEL.trycloudflare.com
```

Select your personal scope, create a new project named `wearaware-demo` (or another available name), and use `./` for its code directory. The checked-in configuration selects Vite, `npm run build`, and `dist`. Do not connect Git if you want to keep this demo's deployment independent of commits. No backend or AI secrets belong in Vercel; `.vercelignore` excludes the local services and environment files from CLI uploads.

Record the stable production website URL shown by Vercel, rather than a unique deployment/preview URL. Login will not work until step 5 is complete.

## 5. Allow the website in your local backend

In `src/wearawarebackend/.env`, replace the example website URL in these settings:

```dotenv
FRONTEND_URL=https://YOUR-PROJECT.vercel.app
CORS_ORIGINS=http://localhost:5173,https://YOUR-PROJECT.vercel.app
TRUST_PROXY=127.0.0.1/32,::1/128
```

Keep existing database and AI settings. Stop the existing backend with Ctrl+C in its terminal and restart it once. Trust only the local tunnel connection; do not set a blanket `TRUST_PROXY=true`.

## 6. Test the demo

Open the stable Vercel URL, sign in, allow camera access, and scan two workers consecutively. Verify saved results in the dashboard and test password recovery if it is part of the presentation. Use demo accounts and records: this tunnel exposes the running application's API publicly.

Your laptop, MongoDB, backend, AI process, and tunnel must remain running. The Vite development server is not required for the Vercel website. Keep your laptop awake during the presentation.

Each new Quick Tunnel normally has a new URL. Repeat the deployment command in step 4 with the new URL whenever the tunnel changes; build-time frontend settings require a new build. The stable Vercel website URL can stay the same.

This setup is temporary demo hosting, not a production deployment. Quick Tunnels have no uptime guarantee. Vercel Hobby is for personal, non-commercial use, subject to its limits.

References: [Vercel CLI deployment](https://vercel.com/docs/cli/deploy), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
