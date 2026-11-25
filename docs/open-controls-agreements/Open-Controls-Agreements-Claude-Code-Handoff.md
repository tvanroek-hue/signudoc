# Open-Controls Agreements · Claude Code handoff

## Start here

Build on [tvanroek-hue/signudoc](https://github.com/tvanroek-hue/signudoc) using [signudoc-security-reliability](https://github.com/tvanroek-hue/signudoc/tree/signudoc-security-reliability) as the base. The branded baseline was published at [f3fec1f](https://github.com/tvanroek-hue/signudoc/commit/f3fec1f59f56d00bbb5f7e4a33d08482fb629258). Fetch the branch and check its current head before making changes. Read the repo's `AGENTS.md` and the installed Next.js guides it points to. Use a new working branch off the hardened branch. Keep production and `main` untouched during development. Run migrations and signing tests only against disposable or explicitly authorized staging data.

**First implementation deliverable**: build the sender dashboard from the approved desktop reference. Wire it to real agreements the viewer already has permission to see, preserve direct agreement links, and reuse the existing recipient delivery actions. Ship later roadmap features as separate, reviewable changes.

## Included assets

The [complete handoff ZIP](https://chatgpt.com/library?file_id=libfile_f87397b8dbbc8191bf8e1acf5fdb5105&account_id=personal) includes both dashboard PNGs. To use the images directly in Claude Code, unzip the archive and put the PNGs next to the logo under `docs/open-controls-agreements/assets/`. They are design references and are optional when running the app.

| File | Use |
|---|---|
| [assets/dashboard-desktop.png](https://chatgpt.com/library?file_id=libfile_5a07029f23f4819189f8418cc689c0fe&account_id=personal) | Original user-selected mockup. Primary desktop reference for composition and hierarchy. |
| [assets/dashboard-mobile.png](https://chatgpt.com/library?file_id=libfile_ad9cb6f2386481918d22ed80eade556f&account_id=personal) | Generated adaptation of the selected desktop mockup. Use it for mobile layout direction. The behaviors below govern where its sample labels differ. |
| [assets/open-controls-icon.svg](assets/open-controls-icon.svg) | Exact approved vector geometry with the app's navy fill. Same asset as `src/app/icon.svg` on the branded branch. Reuse the shipped asset in the app. |

The visible product name is **Open-Controls Agreements**. Use the official Open Controls mark beside the name. Keep the dark navy navigation, light gray page surface, white panels, blue primary action, and labeled status colors shown in the references. Dates, names, document titles and counts in the images are sample data. The live interface must use actual authorized records and omit the sample-data badge.

## What is already on the branch

The current app supports sender accounts, reusable PDF templates, ordered and parallel signing, approvers, audit certificates, and confidentiality controls. The hardening branch added link-only completion emails, two-day download links, access-code checks for protected downloads, revoke/reissue controls, and a retry queue for signing invitations and completion emails. Confidential envelopes are omitted from broader team and administrator views. Preserve those behaviors and the existing custom-branding override. The app name and logo are already implemented. The mockup dashboard layout is a proposed change.

## Dashboard implementation

### Desktop

- Add a persistent navigation area with the product mark and routes for agreements, templates and settings. The mockup shows both Dashboard and Agreements. Use one label for one destination unless both views have a distinct purpose. Keep the user menu and existing scope controls where applicable.
- Put **Agreements** and **New agreement** at the top. Use the existing creation flow.
- Show **Awaiting signature**, **Completed this month**, and **Delivery needs attention**. Compute each total server-side across the permitted scope regardless of the current page of results. Define Awaiting signature as active envelopes with an outstanding signer action, and keep approvals distinguishable in the list. Use the workspace's configured business timezone for date boundaries where available. If none exists, document and test a consistent fallback. Count delivery issues by agreement so several failed recipient emails on one agreement produce one tile count. Exclude cancelled or stale attempts. Scope delivery data consistently with the permissions for the recipient delivery panel.
- Add **All**, **In progress**, and **Completed** filters and searchable agreement titles. Reuse the existing search, filtering and pagination. Define In progress using the app's existing active status logic. Show title, signing status, next action, confidentiality, and a clearly labeled date where it fits. Distinguish agreement status from email status. The same agreement can be awaiting signature and have a failed email.
- Selecting a row opens a detail panel for the active agreement. Show its status, authorized recipient delivery information, and real activity. Keep the dedicated envelope page accessible by a stable URL. Use the existing retry handler and permissions. If the handler retries all failed messages on the envelope, label the action **Retry failed emails** and avoid implying it targets one recipient. Provider acceptance means the provider accepted the send. Confirmed inbox delivery requires an explicit event from the provider.
- Show empty, loading, error, post-retry pending, and failed states. Refresh the delivery state and its count after a successful retry request. Keep the selected agreement and filters stable when practical.

### Mobile and accessibility

Use a compact header and stacked agreement cards on a phone. Show the selected agreement in an accessible drawer or its existing detail page. Adapt the generated mobile reference so search and filters remain accessible even though the image omits them. Keep status readable without color. Use visible focus, accessible names, practical touch targets, and keyboard support. If a drawer is modal, support Escape and restore focus when it closes. Prevent horizontal scrolling at common phone widths.

### Existing entry points

| Area | Starting point |
|---|---|
| Dashboard data and access scopes | `src/app/(app)/dashboard/page.tsx`, `src/lib/envelopes.ts` |
| Dashboard rendering | `src/components/dashboard/dashboard-shell.tsx` |
| Envelope detail and sender delivery actions | `src/app/(app)/envelopes/[id]/page.tsx`, `src/components/envelopes/envelope-delivery-panel.tsx`, `src/app/api/envelopes/[id]/delivery/route.ts` |
| Authorization, queue and branding | `src/lib/envelope-access.ts`, `src/lib/signing-email-deliveries.ts`, `src/lib/branding.ts`, `src/app/icon.svg` |

## Product roadmap

| Phase | Capability | First usable increment |
|---|---|---|
| 1 | Sender dashboard | Ship the design above using authorized live data and existing actions. |
| 2 | Private deal workspaces | Organize one transaction with named buyer, seller, broker and internal roles. Grant access to individual documents and audit external views and downloads. |
| 2 | Multi-document signing packages | Send an agreement and exhibits together, keep distinct finished PDFs, and preview what each recipient sees. |
| 2 | Conditional approvals and routing | Add one commission or transaction-value rule on top of existing approvers. Show the resulting path and reset affected approvals when the approved version changes. |
| 3 | Word-based document generation | Merge approved NDA and referral templates with legal entities and deal terms. Use anchored signing fields and require pre-send preview. |
| 3 | Redlining and version control | Upload and compare Word revisions and bind approvals and sending to the exact released version. |
| 3 | Search and obligations | Add authorized filters and manually confirmed dates or fee triggers. Add extraction with clause references only after manual tracking works. |
| 3 | Higher-assurance verification | Add optional provider-backed ID verification. Capture signing authority separately and minimize retained identity data. |
| 3 | OneDrive and SharePoint | Import approved drafts and archive signed PDFs and certificates only to authorized destinations. Report filing failures. |
| 3 | Controlled partner intake | Collect counterparty and asset details into a review queue. Release diligence material after the required NDA and approval. |
| 3 | Retention policies and legal holds | Assign policies by agreement type, prevent scheduled deletion under a hold, and export signed files with supporting evidence. |

Use a fictional turbine transaction to validate Phase 2. The seller can sign the purchase agreement and review the equipment schedule. The seller cannot see a buyer-side referral agreement. Verify the same restriction in lists, counts, search, previews, exports, and direct routes.

## Release gates and test plan

- **Access**: use the existing centralized access rules on every new query and endpoint. A viewer denied access learns nothing about the confidential agreement through a direct URL, search, count, or error state. Retry, revoke, and reissue stay limited to authorized senders.
- **Delivery**: validate queued, accepted, failed, and cancelled outcomes. Test that a temporary provider failure can be recovered and that a revoked link remains unusable after a worker retry. Avoid logging URLs containing tokens, access codes, or PDF content.
- **UI**: use disposable sample data to check a pending signature, a completed confidential NDA, a failed delivery, and a draft. Exercise search, pagination, keyboard navigation, desktop selection, and the phone layout. Verify with Safari on an actual iPhone before relying on mobile signing in a live rollout.
- **Regression**: run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Run the relevant PostgreSQL and Playwright suites documented in the repo. Add targeted tests for any change to access decisions, counting, or retry behavior that the existing suite misses.
- **Staging**: set production-equivalent setup and cron secrets safely, require two-step sign-in, restrict enrollment, and verify both Blob stores are private. Run sample agreements through live Resend with two authorized external mailboxes, and restore a signed PDF and its audit certificate into an isolated environment. Confirm hosting and monitoring logs redact tokens. Keep full malware scanning as a separate rollout task. The existing upload filter rejects certain active content and embeddings.
- **Delivery to reviewer**: include the changed files, tests actually run, remaining staging checks, and any migrations in the branch summary. Start the next phase only after the dashboard and access behavior are reviewed.

## Prompt to give Claude Code

> Read this handoff and its desktop and mobile references. Inspect the current hardened branch and repo instructions. Implement Phase 1 against the existing app data, routes, and authorization. Keep the exact product name and official logo. Verify the desktop and mobile workflows with sample data, including a confidential-record permissions check and delivery retry state. Work on a new branch. Summarize your changes, tests, and remaining staging checks when done.
