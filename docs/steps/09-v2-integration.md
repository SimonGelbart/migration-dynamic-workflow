# V2 integration

Step ID: `09-v2-integration`. See [the workflow canvas](../workflow.md) for shared rules.

**Status**

Planned.

**Purpose**

Connect fully duplicated pages through the already established code-behind-to-API architecture.

**Inputs**

Green required API evidence, legacy page inventory, target UI conventions and existing migrated examples.

**Procedure**

Copy pages completely with V2 suffixes, including required code-behind/designer/directive changes. Update naming, navigation and bindings. Connect operations incrementally, then verify coherent workflows, postbacks, validation/errors and parent/child interactions. Build after copying. Register every new V2 page in the existing feature-flag mechanism and verify local legacy/V2 routing. Until UI automation is designed, interaction and journey checks are owner checks from a prepared checklist against the locally running application; record each result.

**Outputs**

V2 pages, connected workflow evidence and explicit pending connection tasks.

**Completion**

Every required V2 interaction is verified. A partly connected page is not complete. Record automated and manual verification honestly; use a browser harness when it adds useful coverage.

**Decisions**

Resolve UI outcomes not covered by the target or established examples. Do not introduce a replacement frontend architecture for each resource.

**Recovery**

Recheck impacted interactions after API/UI changes. Keep legacy available through the agreed local flag and preserve existing user work.

**Next**

[Resource verification](10-resource-verification.md).
