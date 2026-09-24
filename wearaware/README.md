# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Worker portal (User role)

Restart the backend after updating: `npm --prefix src/wearawarebackend start`.
Startup creates the `user` role if absent and adds a unique, optional worker-account link index.
Existing admin and inspector accounts do not need worker links.

In **Admin → Worker Registry**, register the worker first. Then go to **User Management → Add User**
(or edit an existing account), select **User (worker portal)**, and choose the linked worker.
Each worker can have one account, including inactive accounts. The existing login email rules apply.

Signing in with that account opens a dashboard with:

- All-time compliance rate: compliant scans divided by total scans, rounded to one decimal place.
  Workers without scans see “No scans yet,” not 100%.
- PPE history in pages of 20 records, with Philippine timestamps.
- A downloadable QR code containing the worker's employee ID, compatible with checkpoint scanning.
- Read-only worker profile and station information. Changes are managed by admins.

The `/api/user/dashboard` endpoint resolves ownership from the current account in MongoDB.
User accounts cannot access admin or inspector endpoints. Deleting a worker clears the account link,
and unlinked accounts are asked to contact their administrator.

Run permission and regression tests with `npm --prefix src/wearawarebackend test`.
These tests use an isolated temporary MongoDB replica set, not the configured application database.

## Security controls and protected AI service

See [docs/SECURITY.md](docs/SECURITY.md) for the Checkpoint 02 security controls, verification commands, recovery changes, and production prerequisites.

The protected inference service is in `services/ppe-api`. The browser now calls the authenticated Express `/api/ppe/detect` endpoint. Start the new Python service from that directory using your inference environment. The backend and Python service must share the private `AI_API_KEY`; example files contain placeholders only.

Password recovery now uses expiring single-use links. Live alerts use authenticated `/alerts` on the API port; the old standalone port 8080 is no longer used. Restart the backend to activate these changes.
