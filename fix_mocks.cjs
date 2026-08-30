const fs = require("fs");
const path = require("path");

const files = [
  "tests/db_persistence.test.ts",
  "tests/m3_persistence_delta.test.ts",
  "tests/e2e_guest_catalog.test.ts",
  "tests/challenger_delete_account_chunking_stress.test.ts",
  "tests/challenger_empirical_adversarial.test.ts",
  "tests/challenger_m4_adversarial.test.ts",
  "tests/tier5_adversarial_guest_catalog.test.ts",
  "tests/workout_deletion_persistence.test.ts",
];

const mockAddition = `    getDb: vi.fn().mockReturnValue({}),\n    ensureAppCheck: vi.fn().mockResolvedValue(undefined),\n`;

let fixed = 0;
for (const file of files) {
  let content = fs.readFileSync(file, "utf8");

  // Skip if already has ensureAppCheck
  if (content.includes("ensureAppCheck")) {
    console.log("SKIP (already patched):", file);
    continue;
  }

  // Replace old 'db: {},' with 'db: {},' + getDb + ensureAppCheck
  // Also handle case where 'db' is not present - we add after 'auth: ...' block
  if (content.includes("db: {},")) {
    content = content.replace("db: {},", `db: {},\n    getDb: vi.fn().mockReturnValue({}),\n    ensureAppCheck: vi.fn().mockResolvedValue(undefined),`);
  } else if (content.includes("waitForPendingWrites:")) {
    // Insert before waitForPendingWrites
    content = content.replace("    waitForPendingWrites:", `    getDb: vi.fn().mockReturnValue({}),\n    ensureAppCheck: vi.fn().mockResolvedValue(undefined),\n    waitForPendingWrites:`);
  } else {
    // Fallback: insert after auth block close
    content = content.replace("vi.mock('../src/lib/firebase', () => ({", 
      `vi.mock('../src/lib/firebase', () => ({\n    getDb: vi.fn().mockReturnValue({}),\n    ensureAppCheck: vi.fn().mockResolvedValue(undefined),`);
  }

  fs.writeFileSync(file, content);
  console.log("FIXED:", file);
  fixed++;
}
console.log(`\nPatched ${fixed} files.`);
