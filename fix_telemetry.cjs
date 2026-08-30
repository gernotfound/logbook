const fs = require("fs");

// Fix telemetry_e2e.test.ts: already imports firebaseLib, just add spies in beforeEach
let c = fs.readFileSync("tests/telemetry_e2e.test.ts", "utf8");
if (!c.includes("ensureAppCheck")) {
  // After the existing spy on 'doc', add ensureAppCheck and getDb spies
  c = c.replace(
    "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });",
    "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });\n    vi.spyOn(firebaseLib, 'ensureAppCheck').mockResolvedValue(undefined);\n    vi.spyOn(firebaseLib, 'getDb').mockReturnValue({} as any);"
  );
  fs.writeFileSync("tests/telemetry_e2e.test.ts", c);
  console.log("FIXED telemetry_e2e.test.ts");
} else {
  console.log("SKIP telemetry_e2e.test.ts (already has ensureAppCheck)");
}

// Fix telemetry_hub.test.ts: needs to import firebaseLib and add spies
let c2 = fs.readFileSync("tests/telemetry_hub.test.ts", "utf8");
if (!c2.includes("ensureAppCheck")) {
  // Add import after existing imports
  c2 = c2.replace(
    "import * as firestoreModule from 'firebase/firestore';",
    "import * as firestoreModule from 'firebase/firestore';\nimport * as firebaseLib from '../src/lib/firebase';"
  );
  // Add spies in beforeEach after existing doc spy
  c2 = c2.replace(
    "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });",
    "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });\n    vi.spyOn(firebaseLib, 'ensureAppCheck').mockResolvedValue(undefined);\n    vi.spyOn(firebaseLib, 'getDb').mockReturnValue({} as any);"
  );
  fs.writeFileSync("tests/telemetry_hub.test.ts", c2);
  console.log("FIXED telemetry_hub.test.ts");
} else {
  console.log("SKIP telemetry_hub.test.ts (already has ensureAppCheck)");
}

// Fix schema_telemetry_fallback.test.ts
let c3 = fs.readFileSync("tests/schema_telemetry_fallback.test.ts", "utf8");
if (!c3.includes("ensureAppCheck")) {
  // Check if it imports firebaseLib
  if (!c3.includes("firebaseLib")) {
    c3 = c3.replace(
      "import * as firestoreModule from 'firebase/firestore';",
      "import * as firestoreModule from 'firebase/firestore';\nimport * as firebaseLib from '../src/lib/firebase';"
    );
  }
  // Find the 'doc' spy and add after it
  if (c3.includes("vi.spyOn(firestoreModule, 'doc')")) {
    c3 = c3.replace(
      "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });",
      "    vi.spyOn(firestoreModule, 'doc').mockImplementation((_db, ...pathSegments) => {\n      return { path: pathSegments.join('/') } as any;\n    });\n    vi.spyOn(firebaseLib, 'ensureAppCheck').mockResolvedValue(undefined);\n    vi.spyOn(firebaseLib, 'getDb').mockReturnValue({} as any);"
    );
  }
  fs.writeFileSync("tests/schema_telemetry_fallback.test.ts", c3);
  console.log("FIXED schema_telemetry_fallback.test.ts");
} else {
  console.log("SKIP schema_telemetry_fallback.test.ts (already has ensureAppCheck)");
}
