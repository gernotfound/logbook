const fs = require('fs');
let md = fs.readFileSync('src/pages/PRIVACY_POLICY.md', 'utf8');

let html = md
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/^### (.*$)/gim, '<h3></h3>')
  .replace(/^## (.*$)/gim, '<h2></h2>')
  .replace(/^# (.*$)/gim, '<h1></h1>')
  .replace(/\*\*(.*?)\*\*/gim, '<strong></strong>')
  .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href=\\"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\"></a>')
  .replace(/^\- (.*$)/gim, '<li></li>');

html = html.replace(/(<li>.*<\/li>[\n\r]*)+/gim, '<ul>$&</ul>');
html = html.replace(/^(?!<)(.*[A-Za-z0-9].*)$/gim, '<p></p>');
html = JSON.stringify(html.replace(/\n/g, ' '));

const tsx = "import React from 'react';\n\n" +
"export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {\n" +
"  return (\n" +
"    <div style={{\n" +
"      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,\n" +
"      backgroundColor: 'var(--bg-color)', zIndex: 100000,\n" +
"      overflowY: 'auto', padding: '20px', paddingBottom: '80px'\n" +
"    }}>\n" +
"      <div style={{ maxWidth: '800px', margin: '0 auto' }}>\n" +
"          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', position: 'sticky', top: '10px', backgroundColor: 'var(--bg-color)', padding: '10px 0' }}>\n" +
"            <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--text-main)' }}>Informativa sulla privacy</h1>\n" +
"            <button className=\"btn btn-secondary\" onClick={onClose}>\n" +
"              Chiudi\n" +
"            </button>\n" +
"          </div>\n" +
"          <div \n" +
"            style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}\n" +
"            dangerouslySetInnerHTML={{ __html: " + html + " }}\n" +
"          />\n" +
"      </div>\n" +
"    </div>\n" +
"  );\n" +
"};\n";

fs.writeFileSync('src/pages/PrivacyPolicy.tsx', tsx);
