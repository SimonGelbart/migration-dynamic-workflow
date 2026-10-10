import { joinSession } from "@github/copilot-sdk/extension";
import { resourceMigration } from "./workflow.mjs";

// stdout belongs to Copilot's extension protocol; do not log to it.
await joinSession({ workflows: [resourceMigration] });
