# API acceptance

Step ID: `05-api-acceptance`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Create repeatable scenarios that assert the final intended API behavior.

**Inputs**

Contracts, rule IDs, actual TUnit/HttpClient harness, API run commands and local LDAP fixture capabilities.

**Procedure**

Inspect the installed harness before extending it. Keep each dependent HTTP journey in one scenario with assertions after meaningful calls. Own synthetic setup/cleanup and declare static data dependencies. Tests run against the development LDAP; they may write only owned test entries, after the owner has authorized those writes (proposed default: once per resource for a named owned subtree or naming prefix, recorded as a decision with its cleanup rule; anything outside needs a new decision), and must account for residual test data. Add a result adapter for the format actually emitted. Track case identities and failure causes, including expected unfinished behavior.

**Outputs**

Compilable/runnable scenarios, fixture instructions, result evidence and scenario-to-slice links.

**Completion**

All selected cases are accounted for. Distinguish passed, expected-red, unexpected failure and infrastructure failure. Missing/empty results, skipped required tests or fixture failures cannot prove acceptance. Expected-red tests still assert the final result, not NotImplementedException.

**Decisions**

Resolve ambiguous expected results and establish the actual LDAP server's relevant capabilities before asserting AD-specific coverage.

**Recovery**

Rerun independently with controlled fixtures. Investigate new failures and changed causes in already-red cases, rather than comparing totals alone.

**Next**

[API slice](06-api-slice.md).
