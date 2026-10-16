# WearAware Checkpoint 02

`WearAware_Checkpoint_02.pdf` and `WearAware_Checkpoint_02.html` update the original **Section 6: Secure Development Practices** table with the current implementation status and direct test evidence from 24 September 2026. Sections 8 and 8.1 document the verified demo deployment: the Vercel frontend, Render Node/Express backend, MongoDB Atlas database, and the protected temporary tunnel from Render to the local PPE AI service. Submit this PDF. `WearAware_Checkpoint_02_Original.pdf` is retained only as a backup.

No Microsoft Word needed: open WearAware_Checkpoint_02.pdf in Preview or any browser. WearAware_Checkpoint_02.html is a standalone browser-readable copy with a Print / Save as PDF button. The DOCX remains available for editing in a compatible editor.

The editable Word document follows the supplied checkpoint template and describes the local code reviewed on 23 September 2026. No application source or real database records were changed for this activity.

## Before submitting

- Fill in the instructor and intended submission date; confirm the team details from AboutUs.jsx.
- The demo frontend is deployed at https://wearaware-demo.vercel.app and the backend is deployed at https://wearaware-api.onrender.com. Set Vercel's `VITE_API_ORIGIN` to the Render URL and redeploy when the deployed frontend must call the hosted backend.
- Confirm whether the instructor accepts the native MongoDB driver. This project does not use Mongoose.
- Ensure the deployed backend uses the same current configuration before presenting it; the recorded test evidence is from the local backend test environment.
- Replace pending Figures 7–9 with actual deployment evidence. Figure 6 is a query-output panel, not a Compass screenshot.
- Review Word print preview before printing.

## Evidence

- Figures 1–3: real local browser captures. Figure 3 uses a disposable synthetic worker account and a separate MongoDB replica set; browser API calls were forwarded to that isolated Express instance.
- Figures 4–6 and 10: formatted records of actual test/query output, not invented UI screenshots.
- backend-tests-current.txt: full unedited output from the current backend suite: 27 passed, 0 failed. The Section 6 transcript is taken from this file.
- security-probes.json: supplemental local checks, including malformed JSON exposing a development stack and missing sampled security headers.
- Architecture diagrams distinguish implemented local components from proposed deployment.

`backend.env.example` contains placeholders only. It is an attachment, not an application configuration change. The application's backend .env.example was absent at the final source check.

Tests use isolated databases. Passing regression tests do not mean all security controls or production deployment requirements are complete.
