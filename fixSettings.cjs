const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');

if (!content.includes('import { PrivacyPolicy }')) {
    content = content.replace("import { useDialogStore } from '../store/useDialogStore';", "import { useDialogStore } from '../store/useDialogStore';\nimport { PrivacyPolicy } from '../pages/PrivacyPolicy';");
}

const regex = /{showPrivacy && \([\s\S]*?\n\s*\)}/m;
const replacement = "{showPrivacy && (\n                <PrivacyPolicy onClose={() => setShowPrivacy(false)} />\n            )}";
content = content.replace(regex, replacement);

fs.writeFileSync('src/components/SettingsView.tsx', content);
