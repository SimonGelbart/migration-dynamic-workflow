# Legacy discovery

Step ID: `01-legacy-discovery`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Implemented as the `discover` workflow operation, together with [target definition](02-target-definition.md). Its checks use a test stand-in for the workflow context; see [verification](../verification.md) for what has and has not run in a live Copilot session.

**Purpose**

Build a thorough baseline of every workflow in the agreed resource boundary.

**Inputs**

An initialized schemaVersion 2 resource record, the four checkouts, relevant existing V2 examples and recorded owner decisions. Runtime UI access and Dev LDAP are not used by the current implementation.

**Procedure**

The workflow rereads readiness, then starts two read-only agents in parallel: one for pages and controls, one for LDAP queries and mappings. Agents trace pages/subpages, navigation, query strings, initial loads/postbacks, conditional fields, normalization, validation and messages; LDAP filters, search scope, mappings and additional filtering; parent/child interactions and side effects. Each returns structured findings classified as observed, code-confirmed, inferred or unresolved, with source references and a coverage list. Agents must not edit, build or contact services. Planned (D06–D10): inspect the development LDAP's naming contexts, schema and representative entries through the read-only LDAP wrapper, and compare them with the application's filters and mappings; when runtime behavior is necessary, prepare a checklist for the owner to run against the locally running application and record the results as observed findings. LDAP observations stay in the private resource directory.

Code then checks the output before saving it. Every reference must name a known checkout and an existing regular file that resolves inside it; classified findings need evidence; unresolved findings need a focused question. Invalid findings are listed as rejected agent output for review and keep the stage in progress. Empty findings or an empty coverage inventory also prevent progression; an excluded or empty resource needs an explicit evidence-backed scope finding and target disposition. If the source fingerprint or decision inputs changed while agents ran, nothing is saved.

Each agent may return at most 300 findings and 500 coverage entries. Exceeding either limit fails with `agent-output-too-large` before saving anything; the workflow never accepts a truncated baseline. Agents must surface the need to split an oversized scope as a focused question rather than silently omit behavior.

**Outputs**

Private `discovery/legacy.json` and `discovery/legacy.md` in the resource directory: coverage, findings with evidence, decisions and rejected output. Scope questions become decisions in `resource.json`.

**Completion**

Code moves the stage to complete only when its evidence is based on the current sources and scope answers, contains valid findings and coverage with no rejected output, and no scope decision is open. Persisted JSON and Markdown have recorded content digests; missing or modified evidence is stale. Review significant branches against the coverage inventory. Missing runtime observations and unknown behavior remain explicit. Structural validation cannot prove completeness; the [reference evaluation](../implementation-plan.md) checks quality.

**Decisions**

An unresolved finding marked as affecting scope pauses the run at `decision/<resource>/01-legacy-discovery/<decision>`. Record the answer with `npm run answer`, then resume the same run or start a new run. Clarifications and rejection feedback from either discovery or target definition become discovery prompt inputs and change the discovery cache key. The agents investigate the clarified boundary even when source files are unchanged, before the target can be regenerated or approved. This conservative policy also investigates target feedback that ultimately leaves scope unchanged. Successful approvals do not trigger another investigation. Target intent remains distinct from source-confirmed legacy behavior.

**Recovery**

Resuming reuses journaled agent output only for identical sources and decision inputs under the current validation policy. Source or input changes, or missing/edited discovery artifacts, cause rediscovery; recorded answers are kept by question. Older version-2 records without artifact/input digests or produced under the earlier routing/truncation policy must reestablish evidence. Cancellation, oversized output or an agent failure saves nothing. Rejected findings are saved for diagnosis but never complete a stage; start a new run to obtain corrected agent output. Linked artifact paths block reads and writes. Record corrections to historical facts separately from intentional V2 changes.

**Next**

[Target definition](02-target-definition.md), in the same run.
