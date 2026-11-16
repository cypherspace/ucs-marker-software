# Future plan: a better AI marking analysis page, and an AI group analysis

**Status: planned, nothing built.** Written 2026-11-16 at the owner's request. Two related pieces of work, in the order they should be done: (1) a much better way to look at how the AI marked, (2) an AI "group analysis" that turns the marks into strengths and weaknesses for a class or cohort.

## Where things are today

- **AI marking page** (`pages/AiMarking.tsx`, `routes/ai.ts`): the lead teacher ticks one or more questions, chooses which clips, and Gemini marks them in browser-driven steps. Below the run settings is one table per question: teacher mark, AI mark, difference, and a "Show response and reasoning" row. The headline numbers are exact-match %, within-one %, average gap and the AI's average bias.
- **What is stored:** the AI's mark, reasoning, feedback and model on `script_marks` (`mark_source = 'ai'`). The **run settings are not stored** (mode, strictness, guidance, whether examples were used, which model), so two runs cannot be compared afterwards.
- **What is not stored at all:** the question paper (only scripts and the mark scheme are uploaded), and any usage or cost figures (`AI usage and cost tracking` is on the not-built list in CLAUDE.md).

## Part 1: a much better UI for analysing AI marking

Goal: let a lead teacher decide, quickly and with evidence, whether the AI can be trusted on a question, and see where it goes wrong.

Ideas, roughly in order of value:

1. **Agreement grid** per question: teacher mark down the side, AI mark across the top, counts in the cells. The diagonal is agreement; off-diagonal cells show whether the AI is harsh or generous and at which mark levels. Click a cell to list those clips.
2. **Bias by mark band:** a small chart of average (AI minus teacher) for low, middle and high teacher marks, since an AI that is fine on average can still be wrong at the top end.
3. **Side-by-side review:** the answer image, the mark scheme region, the teacher's mark and annotations, and the AI's reasoning in one view, with next/previous through the disagreements (reusing the marking page's keep-the-screen navigation and image preloading).
4. **Sort and filter:** by size of gap, by direction, by class, and "AI marked higher than teacher" / "lower".
5. **Whole-exam view:** one row per question (agreement %, bias, clips marked, clips compared) so the lead can see at a glance which questions the AI handles well. This is the natural home for the "AI marking" overview tab.
6. **Compare runs:** change strictness, guidance or model and see whether agreement improved. Needs the run settings stored (below).
7. **Export** the comparison to CSV for the department.
8. **Usage and cost:** requests and tokens per run, against the key's daily allowance.

Data work this needs:

- A small `ai_runs` table (exam, question, mode, strictness, guidance text, examples on/off, model, started/finished, request and token counts) and a `run_id` on AI mark rows, so results can be grouped and compared. Additive migration.
- Teacher marks used for comparison must keep following the exam's combine setting (`finalMarks(..., humanOnly)`), and conflicting teachers' clips should be flaggable ("teachers disagree here too").

## Part 2: AI group analysis (strengths and weaknesses)

Goal: for a class (or the whole cohort), use the marks that already exist, together with the paper and the mark scheme, to produce a written analysis: what the group did well, what they struggled with, common errors, and what to teach next. Like an examiner's report, but for this group.

### Inputs

| Input | Source | Gap |
|---|---|---|
| Marks per question and per script | `script_marks` via `finalMarks()` (the counting mark) | none |
| Mark scheme | existing mark scheme clips per question | none, but mark *points* are not structured |
| Question paper | **not stored today** | upload the paper PDF and clip each question like the mark scheme (or let the teacher paste the question text) |
| Examples of answers | clipped, name-masked images, spread from low to high marks (as `services/anchors.ts` already does for AI examples) | none |
| Teacher annotations and notes | `script_marks.annotation_data` (text notes, ticks and crosses) | optional extra signal |

### Method (keep the counting out of the model)

1. **Statistics in code, not by the AI.** For each question: mark distribution, facility (average / maximum), discrimination (how the strongest and weakest scripts differ), and the same per class. These numbers are exact and cheap.
2. **Mark-point tagging.** For each clip, one structured Gemini call against the mark scheme returns which mark points were awarded and which were missed, plus a short tag for any recurring error. This reuses the existing AI marking call path (`aiMarkClips`, pacing, error handling, browser-driven steps) with a different prompt. Results are stored so they can be aggregated and re-used.
3. **Aggregate in code:** "mark point 2 was missed by 61% of the class", "the commonest error tag was X (14 scripts)".
4. **One summarising call per question** gets the paper question, the mark scheme, the statistics, the aggregated mark-point and error counts, and a few representative anonymous answers. It returns strengths, weaknesses, misconceptions and suggested teaching actions, each pointing to the numbers behind it.
5. **A final call for the whole paper** synthesises the per-question reports into a short summary (themes across questions, topics to revisit, groups of questions that went well).

### Output and UI

- A report page per exam (and per class): headline summary, then a card per question with the statistics, the AI's strengths and weaknesses, and links to example clips as evidence.
- Every claim shows the evidence (counts, example answers) so a teacher can check it. The page is labelled as AI-generated and for teacher review.
- Reports are stored with the settings and model used, versioned, and regenerated on request (marks change as marking continues). New table (`analysis_reports`) and a lead-teacher/admin-only route set; export as a PDF or document for departmental meetings.

### Privacy and safety

- Same rules as AI marking: only name-masked clips are sent, never names or class lists, lead teacher or admin only, paid key on a school-owned project before real student work (see "Before real student work" in CLAUDE.md).
- Per-class reports use class names the teacher already typed at upload; no individual student is identified in the report.
- Group results can still reveal individuals in a small class (for example "one script did X"). Show counts only above a minimum group size, or say so in the UI.

### Risks and open questions

- **Quality depends on the mark scheme and paper being readable by the model.** Test on one real paper before building the UI.
- **Hallucinated patterns.** Mitigated by aggregating real tags in code and requiring evidence for each claim.
- **Cost.** Mark-point tagging is one request per clip, the same order of magnitude as AI marking a class; show the estimate before running, as the AI marking page does.
- **Which marks to trust.** Use the counting mark (teachers' marks first); where only AI marks exist, say so on the report.
- Does the owner want per-class and per-teacher-group reports, or whole-cohort only to begin with?
- Should the report be shareable with students (a "what the class found hard" summary), or staff only? Default: staff only.

## Suggested order of work

1. Store AI run settings (`ai_runs`) and show the agreement grid, bias by band and the side-by-side review (Part 1, items 1-3 and 5).
2. Upload and clip the question paper (small, useful on its own).
3. Mark-point tagging and the statistics aggregation, with a plain table of results and no AI prose yet.
4. The summarising calls and the report page.
5. Per-class reports, export and run comparison.
