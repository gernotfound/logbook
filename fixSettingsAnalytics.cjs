const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsView.tsx', 'utf8');

if (!content.includes('logbook_analytics_consent')) {
    content = content.replace("import { PrivacyPolicy } from '../pages/PrivacyPolicy';", "import { PrivacyPolicy } from '../pages/PrivacyPolicy';\nimport { setAnalyticsConsent } from '../lib/firebase';");
    content = content.replace("const [showPrivacy, setShowPrivacy] = useState(false);", "const [showPrivacy, setShowPrivacy] = useState(false);\n    const [analyticsEnabled, setAnalyticsEnabled] = useState(localStorage.getItem('logbook_analytics_consent') === 'true');\n\n    const handleAnalyticsToggle = () => {\n        const newState = !analyticsEnabled;\n        setAnalyticsEnabled(newState);\n        setAnalyticsConsent(newState);\n    };");
    
    const uiReplacement = "<div style={{ marginTop: '10px' }}>\n                <div className=\"form-group\" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>\n                    <div>\n                        <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem', color: 'var(--text-main)' }}>Statistiche di utilizzo</h3>\n                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Condividi dati anonimi di diagnostica e Analytics per aiutarci a migliorare l'app.</p>\n                    </div>\n                    <div className=\"toggle-switch\">\n                        <input type=\"checkbox\" id=\"analytics-toggle\" checked={analyticsEnabled} onChange={handleAnalyticsToggle} />\n                        <label htmlFor=\"analytics-toggle\"></label>\n                    </div>\n                </div>\n            </div>\n\n            <div style={{ marginTop: '10px' }}>";
    content = content.replace("<div style={{ marginTop: '10px' }}>\n                <button className=\"btn\"", uiReplacement + "\n                <button className=\"btn\"");
    fs.writeFileSync('src/components/SettingsView.tsx', content);
}
