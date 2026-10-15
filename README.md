# Resume Tailor

A local web app for tailoring Justin Mendoza's three verified resume versions to a job description. DeepSeek (`deepseek-v4.1-flash`), accessed through Kyma, analyzes the posting; the app immediately shows structured, verified-data-only edits while the model automatically refines them. The server validates every operation against `data/verified_experience.json`, keeps substantive verified suggestions ahead of cosmetic reorders, shows a diff, applies only approved edits, and renders LaTeX into a PDF.

## Run locally

1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env` on first setup and enter your Kyma API key. The current model selection is DeepSeek through the existing Kyma adapter:

   ```dotenv
   KYMA_API_KEY=your_kyma_api_key
   KYMA_MODEL=deepseek-v4.1-flash
   KYMA_REFINE_TIMEOUT_MS=60000
   ```

   Keep `LLM_PROVIDER` unset or set it to `kyma`; DeepSeek is selected with `KYMA_MODEL`, not a separate provider adapter. `KYMA_BASE_URL` defaults to `https://kymaapi.com/v1` and can override the compatible API endpoint. If `KYMA_MODEL` is omitted or empty, the code still falls back to `qwen3.8-flash`. Refinement defaults to 60 seconds and is capped at 120 seconds. Restart `npm start` after changing `.env`, because the server loads configuration at startup.
3. Install a local TeX distribution that provides `latexmk` or `pdflatex`. The templates use the original Overleaf `fullpage` (TeX Live package `preprint`), `titlesec`, and `enumitem` packages, plus `hyperref`, `fancyhdr`, `babel`, `tabularx`, and Computer Modern fonts. On macOS, the app also checks `/Library/TeX/texbin`. For BasicTeX, install the additional packages in your user TeX folder (no admin password):

   ```sh
   /Library/TeX/texbin/tlmgr --usermode init-usertree
   /Library/TeX/texbin/tlmgr --usermode install preprint titlesec enumitem cm-super
   ```

   Run `init-usertree` only on first setup; skip it if the user tree already exists.
4. Run `npm start` and open `http://127.0.0.1:3001`. Set `PORT` if you need a different port.

No npm install is required. The server binds only to localhost. The Kyma key is read by the server and is never sent to the browser. The job description, resume-category names, and original verified bullet evidence go to the configured model for requirement analysis. Selected resume structure and relevant verified facts go to the configured model automatically for refinement after analysis; the app does not upload PDFs or contact details. Review controls unlock when refinement completes or times out, and verified local suggestions remain available either way. A retry button is available. Approved PDFs, LaTeX source, extracted text, and JSON coverage reports are saved in the ignored `output/pdf/` directory.

## Verified resume data

`data/verified_experience.json` was transcribed from these one-page PDFs supplied by the user:

- `/Users/justin/Documents/Justin_Mendoza.pdf` → General Software Engineering
- `/Users/justin/Documents/Justin_Mendoza_AI.pdf` → AI / Search / ML Infrastructure
- `/Users/justin/Documents/Justin_Mendoza_INFRA.pdf` → Backend / Infrastructure

The three selection files in `data/resumes/` refer to verified skill, employer, project, bullet, and education IDs. `variants` contains version-specific PDF wording and a small set of manually curated alternatives using project technologies already linked in this profile; the model may select these or propose evidence-backed rewrites that pass deterministic checks and a separate model audit. Review those alternatives before using them for applications. `templates/` preserves the supplied Overleaf `main.tex` margins, section formatting, nested itemize lists, and font defaults; the content remains structured data, and only explicit emphasis metadata controls bold text. The original formatting packages must be installed; the renderer does not substitute approximate list spacing. Review the transcribed profile before relying on it for applications.

Aggressive tailoring is the default. The model can substantially rewrite bullets using same-entry evidence, combine verified details, select a more relevant verified bullet, optimize complete skill groups, reorder projects and bullets, or select a curated variant. There is no fixed edit or keyword count. Multiple bullets within one entry can be improved independently. The existing per-change diff and approval workflow remains required. Employers, dates, official titles, education, chronology, and the LaTeX templates remain fixed.

## PDF checks

The compiler runs with shell escape disabled. Text extraction uses Poppler (`pdftotext`) or macOS PDFKit; install Poppler on other platforms. Export fails if text extraction is unavailable or parsing checks fail. It validates contacts, section and bullet order, factual fields, displayed skill labels, and exact keywords. LaTeX overfull-box warnings block export. Text extraction cannot prove the absence of clipping or overlap: inspect the PDF preview before submitting. Compilation errors are shown in the UI. The app confirms the PDF exists and begins with a PDF signature. It checks page count with `pdfinfo`, or with macOS PDFKit when `pdfinfo` is unavailable; a multi-page result is rejected. If neither page-count method exists, export fails because one-page output cannot be verified.

## Extend the provider

`src/providers/index.js` defines the small provider boundary: `analyzeJD(input)`, `suggestEdits(input)`, `reviewEdits(input)`, and `connectionNote(input)` return JSON objects. `src/providers/kyma.js` is the current adapter and sends the configured model ID to Kyma’s chat-completions endpoint with JSON response mode. Its filename refers to the API provider, so it also handles the current DeepSeek selection. Some runtime status/error labels still say Qwen; those labels do not select the model. A future adapter can implement the same interface; the server-side validation and deterministic renderer stay unchanged.

Run `npm test` for local validation and rendering checks.

## Evidence-based requirement matching

The configured model returns canonical requirements, common aliases, category, priority, verbatim job-description source, and optional bullet IDs with exact evidence quotations. Source excerpts and technical terms are checked locally. Required technical skills rank above preferred qualifications; duplicate requirements and keyword frequency never add weight. Resume selection compares critical, high, medium, then low priority coverage; no ATS score is predicted.

The four dimensions are exact keyword presence, semantic requirement coverage, relevant experience evidence, and PDF parsing compatibility. Matching preserves tokens such as Go, C++, C#, and Node.js and multiword phrases. Curated aliases in the verified profile (such as AWS/Amazon Web Services and Kubernetes/K8s) support equivalent terminology. Model-suggested technical aliases cannot establish equivalence; unverified technical equivalences remain related. TypeScript and JavaScript are distinct requirements even when displayed together. Responsibilities require bullet evidence rather than a skill-list mention. Semantic responsibility assessments remain advisory: a real quoted bullet establishes provenance, not mathematical proof of equivalence. A resume declaration is identified separately from demonstrated bullet evidence.

New prose requires same-entry source bullet IDs, including the target bullet. Deterministic checks preserve original measurements and named technologies, reject invented numbers, restrict technology provenance and elevated ownership/deployment language, and reject hidden control text or LaTeX. A separate batch LLM audit then checks every factual clause, metric scope, potential versus realized outcomes, production claims, unsupported tools, and writing improvement. Only exact audited wording can reach approval; the server revalidates approved changes before compilation. This audit is a model judgment, not a factual guarantee. Unsupported valuable enhancements appear as confirmation questions and stay excluded until the verified profile is updated. Skill reorders preserve the full skill set. New skills must already exist in the verified profile. Strong bullets can remain unchanged; zero changes is valid. No model-generated prose is automatically treated as verified experience.

The UI shows requirement priority, match class, source, and evidence. Export includes `.tex`, `.pdf`, extracted `.txt`, and `.report.json` with exact/equivalent matches, missing and related requirements, priority coverage, existing versus introduced keywords, approved before/after edits, source evidence, factual review rationale, confirmation questions, and parsing results. Education, titles, employers, dates, and chronology remain fixed. No platform-specific scoring weights or assumptions are built in.

Design references: [Resume-Matcher's diff validation](https://github.com/srbhr/Resume-Matcher/blob/main/apps/backend/app/services/improver.py) informed the whitelist, original-value, and preservation safeguards; [ATS Screener](https://github.com/sunnypatell/ats-screener) informed the separation of keyword matching and parsing concerns. Neither application's UI, vendor simulations, nor scoring weights were copied.

Aggressive rewrite implementation: `src/rewrite-validation.js` contains deterministic gates, provenance binding, and batched audit orchestration; `src/matcher.js` contains narrow competency implications and priority-based matching. Curated implications include fault tolerance from outage buffering, asynchronous processing from producers/consumers, containerization from Docker, and stateful design from persistence plus deduplication. Related technologies never authorize equivalent skills. Skills can be added from the full verified profile, but a global skill declaration does not establish use in a specific project.

A typical run uses two model calls (requirements, edits) plus one batch audit when new prose is proposed. The audit has a 30-second timeout; the existing analysis timeout is 45 seconds and edit timeout defaults to 60 seconds. Actual latency varies; 1–2 minutes is a goal, not a guarantee. Audit or refinement failure leaves the verified local fallback available. No new dependencies or services are required.

Export requires a verified single page, searchable text, intact content/reading order and no reported overfull boxes. Overflow rejects export; reject a lengthening edit rather than shrinking margins or fonts. Visual preview is still necessary to catch clipping/overlap that text extraction cannot establish. Tests use mocked model outputs for reproducibility; `npm test` also compiles all three templates and an approved rewrite when LaTeX plus Poppler or macOS PDFKit are available, otherwise that integration test explicitly skips. Live-provider wording quality and latency require evaluation against actual postings.

## ATS diagnostics

The analysis and final approved-resume report include weighted **demonstrated requirement coverage**: critical = 5, high = 4, medium = 2, low = 1. The percentage is demonstrated weight divided by total requirement weight (N/A for no requirements). Verified experience/project evidence, including narrow evidence-backed competencies, earns credit; skills-only declarations and related-only assessments do not. This is a diagnostic, not an official ATS score or an optimization threshold. Existing priority-first base-resume selection remains unchanged.

The report distinguishes exact JD keywords, equivalent matches, critical requirements demonstrated or lacking demonstration, unsupported requirements, and presentation gaps. Presentation gaps include accurate JD wording that could be surfaced, skills declared without bullet evidence, and verified skills absent from the selected content. Technical requirements retain the JD's terminology when the model canonicalizes an equivalent alias. Existing before/after keyword lists still identify terms incorporated through approved edits.

`src/diagnostics.js` adds local repetition warnings and target-title terminology checks. Three or more mentions of the same technology (including curated aliases) within one bullet or skill group trigger an advisory review hint. This heuristic neither rejects export nor reduces coverage. Repeating a technology across Skills, project stacks, and substantive experience is allowed; the number of distinct technologies is unrestricted. Warnings need human judgment and may flag legitimate repetition.

Target-title diagnostics use the supplied job title and a small curated role vocabulary. They identify wording to review, never authorize unsupported experience, and never change previous official titles or seniority. Exact target-title presence is informational; absence is not a qualification failure. These diagnostics and presentation gaps appear in the existing final report display and downloaded JSON. PDF extraction continues using the existing contact, date, title, heading, skill, and reading-order validation; no additional PDF parser or model calls were introduced.

After successful resume generation, a LinkedIn connection note appears below the PDF preview with a **Copy connection note** button and character count. The PDF is available immediately; a separate request personalizes the note with the configured LLM using the full JD, role/company, and approved final experience bullets. The model selects a compact factual hook and returns supporting evidence IDs. Local checks enforce the 300-character maximum, cited evidence, supported technologies and numbers, followed by the existing independent factual audit. The generation call times out after 20 seconds and the audit after 30 seconds; any failure, invalid output or unsupported claim uses the complete deterministic fallback (`src/connection-note.js`). Repeated requests reuse the note promise for the current PDF. No draft is blindly truncated. The copy button unlocks when personalization finishes; stale results cannot replace a newer application's note. Clipboard errors leave the note available for manual copying. The app does not send LinkedIn invitations or messages.
