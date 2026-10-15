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

No npm install is required. The server binds only to localhost. The Kyma key is read by the server and is never sent to the browser. The job description, resume-category names, and original verified bullet evidence go to Qwen for requirement analysis. Selected resume structure and relevant verified facts go to Qwen automatically for refinement after analysis; the app does not upload PDFs or contact details. Review controls unlock when refinement completes or times out, and verified local suggestions remain available either way. A retry button is available. Approved PDFs, LaTeX source, extracted text, and JSON coverage reports are saved in the ignored `output/pdf/` directory.

## Verified resume data

`data/verified_experience.json` was transcribed from these one-page PDFs supplied by the user:

- `/Users/justin/Documents/Justin_Mendoza.pdf` → General Software Engineering
- `/Users/justin/Documents/Justin_Mendoza_AI.pdf` → AI / Search / ML Infrastructure
- `/Users/justin/Documents/Justin_Mendoza_INFRA.pdf` → Backend / Infrastructure

The three selection files in `data/resumes/` refer to verified skill, employer, project, bullet, and education IDs. `variants` contains version-specific PDF wording and a small set of manually curated alternatives using project technologies already linked in this profile; these are the only wordings the model may select. Review those alternatives before using them for applications. `templates/` preserves the supplied Overleaf `main.tex` margins, section formatting, nested itemize lists, and font defaults; the content remains structured data, and only explicit emphasis metadata controls bold text. The original formatting packages must be installed; the renderer does not substitute approximate list spacing. Review the transcribed profile before relying on it for applications.

The model can propose adding an already verified skill to a compatible skill group, reordering skills, projects, project technologies, or bullets, or selecting a preverified bullet variant. It cannot send new resume prose or LaTeX. The validation layer rejects unknown IDs, unsupported JD terms, incompatible skill groups, invalid permutations, and unapproved operations. Company names, dates, education, metrics, and accomplishments come only from the checked profile.

## PDF checks

The compiler runs with shell escape disabled. Text extraction uses Poppler (`pdftotext`) or macOS PDFKit; install Poppler on other platforms. Export fails if text extraction is unavailable or parsing checks fail. It validates contacts, section and bullet order, factual fields, displayed skill labels, and exact keywords. LaTeX overfull-box warnings block export. Text extraction cannot prove the absence of clipping or overlap: inspect the PDF preview before submitting. Compilation errors are shown in the UI. The app confirms the PDF exists and begins with a PDF signature. It checks page count with `pdfinfo`, or with macOS PDFKit when `pdfinfo` is unavailable; a multi-page result is rejected. If neither page-count method exists, the UI reports that the count was unavailable.

## Extend the provider

`src/providers/index.js` defines the small provider boundary: `analyzeJD(input)` and `suggestEdits(input)` return JSON objects. `src/providers/kyma.js` is the current adapter. A future adapter can implement the same interface; the server-side validation and deterministic renderer stay unchanged.

Run `npm test` for local validation and rendering checks.

## Evidence-based requirement matching

Qwen returns canonical requirements, common aliases, category, priority, verbatim job-description source, and optional bullet IDs with exact evidence quotations. Source excerpts and technical terms are checked locally. Required technical skills rank above preferred qualifications; duplicate requirements and keyword frequency never add weight. Resume selection compares high-priority coverage before medium and low coverage; no ATS score is predicted.

The four dimensions are exact keyword presence, semantic requirement coverage, relevant experience evidence, and PDF parsing compatibility. Matching preserves tokens such as Go, C++, C#, and Node.js and multiword phrases. Curated aliases in the verified profile (such as AWS/Amazon Web Services and Kubernetes/K8s) support equivalent terminology. Model-suggested technical aliases cannot establish equivalence; unverified technical equivalences remain related. TypeScript and JavaScript are distinct requirements even when displayed together. Responsibilities require bullet evidence rather than a skill-list mention. Semantic responsibility assessments remain advisory: a real quoted bullet establishes provenance, not mathematical proof of equivalence. A resume declaration is identified separately from demonstrated bullet evidence.

Before/after diffs remain limited to preverified wording variants and whitelisted operations. The validator rejects stale originals, metric changes, and loss of explicitly named technologies, and revalidates approved changes immediately before compilation. Skill reorders preserve the full skill set. New skills must already exist in the verified profile. Strong bullets can remain unchanged; zero changes is valid. No model-generated prose is automatically treated as verified experience.

The UI shows requirement priority, match class, source, and evidence. Export includes `.tex`, `.pdf`, extracted `.txt`, and `.report.json` with exact/equivalent matches, missing and related requirements, priority coverage, existing versus introduced keywords, approved before/after edits, and parsing results. Education, titles, employers, dates, and chronology remain fixed. No platform-specific scoring weights or assumptions are built in.

Design references: [Resume-Matcher's diff validation](https://github.com/srbhr/Resume-Matcher/blob/main/apps/backend/app/services/improver.py) informed the whitelist, original-value, and preservation safeguards; [ATS Screener](https://github.com/sunnypatell/ats-screener) informed the separation of keyword matching and parsing concerns. Neither application's UI, vendor simulations, nor scoring weights were copied.
