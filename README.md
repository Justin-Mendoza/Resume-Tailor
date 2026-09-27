# Resume Tailor

A local web app for tailoring Justin Mendoza's three verified resume versions to a job description. Qwen 3.8 Flash analyzes the posting and suggests structured operations. The server validates those operations against `data/verified_experience.json`, shows a diff, applies only approved edits, and renders LaTeX into a PDF.

## Run locally

1. Use Node.js 20 or newer.
2. Put your Kyma API key in `.env` as `KYMA_API_KEY=...`. The app uses `KYMA_MODEL` if set; the default is `qwen3.8-flash`. It accepts the `qwen-3.8-flash` spelling in the current `.env` and sends Kyma's documented `qwen3.8-flash` model ID. Optionally set `KYMA_BASE_URL` for another Kyma-compatible endpoint.
3. Install a local TeX distribution that provides `latexmk` or `pdflatex` and the `geometry`, `lmodern`, and `hyperref` packages. On macOS, the app also checks `/Library/TeX/texbin`, so BasicTeX works before you restart your terminal.
4. Run `npm start` and open `http://127.0.0.1:3001`. Set `PORT` if you need a different port.

No npm install is required. The server binds only to localhost. The Kyma key is read by the server and is never sent to the browser. The job description, selected resume structure, and relevant verified facts are sent to Kyma for analysis; the app does not upload PDFs or contact details. Approved PDFs are saved in the ignored `output/pdf/` directory. If Qwen's edit suggestion call is slow or unavailable, a local verified-data fallback proposes a safe edit.

## Verified resume data

`data/verified_experience.json` was transcribed from these one-page PDFs supplied by the user:

- `/Users/justin/Documents/Justin_Mendoza.pdf` → General Software Engineering
- `/Users/justin/Documents/Justin_Mendoza_AI.pdf` → AI / Search / ML Infrastructure
- `/Users/justin/Documents/Justin_Mendoza_INFRA.pdf` → Backend / Infrastructure

The three selection files in `data/resumes/` refer to verified skill, employer, project, bullet, and education IDs. Version-specific wording found in the PDFs is stored as `variants` and is the only wording the model may select. `templates/` contains deterministic LaTeX layout files. Since the supplied source files were PDFs, these are reconstructed templates; replacing them with the original `.tex` layouts is the way to preserve the exact original appearance. Review the transcribed profile before relying on it for applications.

The model can propose adding an already verified skill to a compatible skill group, reordering skills, reordering project technologies or bullets, or selecting a preverified bullet variant. It cannot send new resume prose or LaTeX. The validation layer rejects unknown IDs, unsupported JD terms, incompatible skill groups, invalid permutations, and unapproved operations. Company names, dates, education, metrics, and accomplishments come only from the checked profile.

## PDF checks

The compiler runs with shell escape disabled. Compilation errors are shown in the UI. The app confirms the PDF exists and begins with a PDF signature. It checks page count with `pdfinfo`, or with macOS PDFKit when `pdfinfo` is unavailable; a multi-page result is rejected. If neither page-count method exists, the UI reports that the count was unavailable.

## Extend the provider

`src/providers/index.js` defines the small provider boundary: `analyzeJD(input)` and `suggestEdits(input)` return JSON objects. `src/providers/kyma.js` is the current adapter. A future adapter can implement the same interface; the server-side validation and deterministic renderer stay unchanged.

Run `npm test` for local validation and rendering checks.
