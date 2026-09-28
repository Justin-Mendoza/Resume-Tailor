# Resume Tailor

A local web app for tailoring Justin Mendoza's three verified resume versions to a job description. Qwen 3.8 Flash analyzes the posting; the app immediately shows structured, verified-data-only edits while Qwen automatically refines them. The server validates every operation against `data/verified_experience.json`, keeps substantive verified suggestions ahead of cosmetic reorders, shows a diff, applies only approved edits, and renders LaTeX into a PDF.

## Run locally

1. Use Node.js 20 or newer.
2. Put your Kyma API key in `.env` as `KYMA_API_KEY=...`. The app uses `KYMA_MODEL` if set; the default is `qwen3.8-flash`. It accepts the `qwen-3.8-flash` spelling in the current `.env` and sends Kyma's documented `qwen3.8-flash` model ID. Optionally set `KYMA_BASE_URL` for another Kyma-compatible endpoint. Qwen refinement defaults to 60 seconds (`KYMA_REFINE_TIMEOUT_MS`) and is capped at 120 seconds.
3. Install a local TeX distribution that provides `latexmk` or `pdflatex`. The templates use the original Overleaf `fullpage` (TeX Live package `preprint`), `titlesec`, and `enumitem` packages, plus `hyperref`, `fancyhdr`, `babel`, `tabularx`, and Computer Modern fonts. On macOS, the app also checks `/Library/TeX/texbin`. For BasicTeX, install the additional packages in your user TeX folder (no admin password):

   ```sh
   /Library/TeX/texbin/tlmgr --usermode init-usertree
   /Library/TeX/texbin/tlmgr --usermode install preprint titlesec enumitem cm-super
   ```

   Run `init-usertree` only on first setup; skip it if the user tree already exists.
4. Run `npm start` and open `http://127.0.0.1:3001`. Set `PORT` if you need a different port.

No npm install is required. The server binds only to localhost. The Kyma key is read by the server and is never sent to the browser. The job description and resume-category names go to Qwen for analysis. Selected resume structure and relevant verified facts go to Qwen automatically for refinement after analysis; the app does not upload PDFs or contact details. Review controls unlock when refinement completes or times out, and verified local suggestions remain available either way. A retry button is available. Approved PDFs are saved in the ignored `output/pdf/` directory.

## Verified resume data

`data/verified_experience.json` was transcribed from these one-page PDFs supplied by the user:

- `/Users/justin/Documents/Justin_Mendoza.pdf` → General Software Engineering
- `/Users/justin/Documents/Justin_Mendoza_AI.pdf` → AI / Search / ML Infrastructure
- `/Users/justin/Documents/Justin_Mendoza_INFRA.pdf` → Backend / Infrastructure

The three selection files in `data/resumes/` refer to verified skill, employer, project, bullet, and education IDs. `variants` contains version-specific PDF wording and a small set of manually curated alternatives using project technologies already linked in this profile; these are the only wordings the model may select. Review those alternatives before using them for applications. `templates/` preserves the supplied Overleaf `main.tex` margins, section formatting, nested itemize lists, and font defaults; the content remains structured data, and only explicit emphasis metadata controls bold text. The original formatting packages must be installed; the renderer does not substitute approximate list spacing. Review the transcribed profile before relying on it for applications.

The model can propose adding an already verified skill to a compatible skill group, reordering skills, projects, project technologies, or bullets, or selecting a preverified bullet variant. It cannot send new resume prose or LaTeX. The validation layer rejects unknown IDs, unsupported JD terms, incompatible skill groups, invalid permutations, and unapproved operations. Company names, dates, education, metrics, and accomplishments come only from the checked profile.

## PDF checks

The compiler runs with shell escape disabled. Compilation errors are shown in the UI. The app confirms the PDF exists and begins with a PDF signature. It checks page count with `pdfinfo`, or with macOS PDFKit when `pdfinfo` is unavailable; a multi-page result is rejected. If neither page-count method exists, the UI reports that the count was unavailable.

## Extend the provider

`src/providers/index.js` defines the small provider boundary: `analyzeJD(input)` and `suggestEdits(input)` return JSON objects. `src/providers/kyma.js` is the current adapter. A future adapter can implement the same interface; the server-side validation and deterministic renderer stay unchanged.

Run `npm test` for local validation and rendering checks.
