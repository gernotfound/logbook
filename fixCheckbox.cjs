const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');

content = content.replace(
    /<div className="toggle-switch">[\s\S]*?<\/div>/m,
    "<input type=\"checkbox\" id=\"analytics-toggle\" checked={analyticsEnabled} onChange={handleAnalyticsToggle} style={{ width: '24px', height: '24px', accentColor: 'var(--primary-color)' }} />"
);

fs.writeFileSync('src/components/SettingsView.tsx', content);
