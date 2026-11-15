# 19. Script editor: engine choice and the tools users need

Status: research, 2026-11-15. Asked by Michael during the code editor climb: which editor tools would help script authors, and is Monaco the right embeddable TypeScript editor. Findings come from a research pass over vendor docs and repositories; each claim below cites its source.

## Recommendation

**Stay on Monaco, upgrade to the current release (0.57.0 on npm at 2026-11-15), and slim the bundle.** The heaviest part of any in-browser TypeScript editor is the TypeScript compiler worker: our `ts.worker` is 6.9 MB minified (1.48 MB gzipped), and any editor that type-checks against our `.d.ts` in the browser ships the same compiler. Switching would not shrink that, and would cost a rewrite of completion, hover, diagnostics and theming.

Then build the tools in the ranked list below, starting with running a script against a sample message. The upgrade must carry or retire the suggest-widget patch (D-267).

## Engines considered

| Engine | TypeScript support | Fit for us |
|---|---|---|
| Monaco (current) | Full TS language service in workers, custom extra libs (how we load the sandbox and code-template declarations) | Best fit. Best screen-reader support of the options [7]. No mobile support per its README [1]. 0.56 added tree-shakeable entry points (`monaco-editor/editor`) and treats language-server markdown as untrusted [2]. |
| CodeMirror 6 | None built in; `@valtown/codemirror-ts` was archived on 2025-09-19 in favour of a server-side LSP [8][9] | Better on phones and lighter core [5][6], but we would own the TypeScript integration. |
| Sandpack | Wraps CodeMirror; runs front-end apps [12][13] | No: our scripts run in a server sandbox. |
| StackBlitz WebContainers | A Node runtime in the browser, needs cross-origin isolation, commercial licence terms [14][15] | No: same reason. |
| TypeScript Playground "Sandbox" | Monaco wrapper on the AMD loader [16] | Reference only. |
| Ace | No TypeScript type checking out of the box [17] | Not an upgrade. |
| modern-monaco | Monaco with Shiki and a built-in TS LSP; README says the API may change at any time [18] | Too unstable for us. |

Prior art: Pipedream code steps and Airtable scripting both embed Monaco [19][20].

## What comparable products give script authors

| Tool | Who has it | Value for an HL7 transformer |
|---|---|---|
| Run against a sample message, show output and console | Iguana [21], InterSystems DTL Test Transform [22], Windmill [23], Zapier [24], Airtable [20], Pipedream [19], AWS Lambda test events [25] | Very high: the basic loop. |
| Per-line values from the last run | Iguana annotations: each executed line's arguments and return values, live as you edit [21] | Highest debugging value; large to build. |
| Message tree that inserts paths | Mirth's Message Trees tab, drag a node into a step [26] | High for people who do not remember `PID.5.1`. |
| Saved, named test inputs | Lambda shared test events [25], n8n pinned data [27] | High: regression fixtures for ADT and ORU variants. |
| Versions and diff against deployed | Mirth Channel History (paid) [32], Windmill deploy hashes [23], Val Town versions [10] | High for safe changes and audit. |
| Snippets | Postman snippets [28], Airtable examples [20] | Medium; our reference panel covers part of it. |
| AI assist | n8n (sees the schema only, not values) [30], Postman [28], Zapier [24], Windmill [31] | Medium; needs a PHI rule first (schema or tree only, never message content). |
| Format, toggle comment | Open Integration Engine 4.6.0 [33] | Low; we have both. |

No product read offered a breakpoint debugger; Iguana's per-line values fill that role [21].

## Ranked shortlist for GalvaniFlow

1. **Run the script against a sample message**: show the result, `logger` output and errors as editor problems. Medium (a dry-run endpoint on the sandbox, no message stored, audited because the sample can be PHI). **Built 2026-11-15 (D-266)**, except showing a script error as an editor problem: it shows in the result panel.
2. **Saved test messages per channel or script, with expected output**: regression checks instead of clicking. Medium.
3. **HL7 message tree from the sample**: click to insert a path, typed against `msg`. Medium.
4. **Diff the editor against the deployed revision** (CodeDiffEditor already exists), then revision history per script. Small for the diff, medium for history.
5. **Slim Monaco**: upgrade to 0.57, import `monaco-editor/editor` with only TypeScript, JavaScript, JSON and HL7, and drop the CSS and HTML workers (about 1.8 MB minified we never load, plus most of 80 languages). Small.
6. **Per-line values (Iguana-style)**: needs statement tracing in the sandbox and inlay rendering. Large; after 1 and 2.
7. **HL7 snippets** in the reference panel (iterate repeats, reformat a date, insert a segment). Small.
8. **AI assist on the schema or tree only.** Medium; needs the PHI decision first.

## Sources

1. https://github.com/microsoft/monaco-editor
2. https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md
5. https://codemirror.net/
6. https://codemirror.net/docs/guide/
7. https://github.com/microsoft/monaco-editor/wiki/Monaco-Editor-Accessibility-Guide
8. https://github.com/val-town/codemirror-ts
9. https://github.com/val-town/vtlsp
10. https://docs.val.town/vals/
12. https://sandpack.codesandbox.io/docs/
13. https://sandpack.codesandbox.io/docs/advanced-usage/components
14. https://developer.stackblitz.com/platform/api/webcontainer-api
15. https://webcontainers.io/guides/quickstart
16. https://www.typescriptlang.org/dev/sandbox/
17. https://github.com/ajaxorg/ace
18. https://github.com/esm-dev/modern-monaco
19. https://pipedream.com/docs/workflows/building-workflows/code/nodejs
20. https://support.airtable.com/docs/scripting-extension-overview
21. https://help.interfaceware.com/v6/annotations
22. https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=EDTL_test
23. https://www.windmill.dev/docs/getting_started/scripts_quickstart/typescript
24. https://help.zapier.com/hc/en-us/articles/8496310939021-Use-JavaScript-code-in-Zaps
25. https://docs.aws.amazon.com/lambda/latest/dg/testing-functions.html
26. https://docs.nextgen.com/en-US/mirthc2ae-connect-by-nextgen-healthcare-user-guide-3229478/message-trees-tab-14261 (search excerpt only; the page refused automated fetches)
27. https://docs.n8n.io/data/data-pinning/
28. https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/
30. https://docs.n8n.io/code/ai-code/
31. https://www.windmill.dev/docs/code_editor
32. https://docs.nextgen.com/en-US/mirthc2ae-connect-by-nextgen-healthcare-user-guide-3231169/channel-history-12753 (search excerpt only)
33. https://github.com/OpenIntegrationEngine/engine/releases

Not covered: Rhapsody, the Azure Functions and Logic Apps portal editors, Supabase and Retool, whose pages did not load. Source numbers follow the research notes, so a few are skipped.
