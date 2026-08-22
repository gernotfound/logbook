const fs = require('fs');
let content = fs.readFileSync('src/lib/firebase.ts', 'utf8');

content = content.replace(
    /isSupported\(\)\.then\(\(supported\) => \{\s*if \(supported\) \{\s*analytics = getAnalytics\(app\);\s*\}\s*\}\)\.catch/m,
    "isSupported().then((supported) => {\n    if (supported && localStorage.getItem('logbook_analytics_consent') === 'true') {\n        analytics = getAnalytics(app);\n    }\n}).catch"
);

// We need an export function to toggle it dynamically.
const toggleAnalytics = "\nexport const setAnalyticsConsent = (consent: boolean) => {\n    localStorage.setItem('logbook_analytics_consent', consent ? 'true' : 'false');\n    if (consent && !analytics) {\n        isSupported().then(supported => {\n            if (supported) analytics = getAnalytics(app);\n        });\n    } else if (!consent && analytics) {\n        analytics = null;\n    }\n};\n";

if (!content.includes('setAnalyticsConsent')) {
    content = content.replace("export { auth", toggleAnalytics + "export { auth");
    content = content.replace("isAppCheckFallbackOffline };", "isAppCheckFallbackOffline, setAnalyticsConsent };");
}

fs.writeFileSync('src/lib/firebase.ts', content);
