const fs = require('fs');

let content = fs.readFileSync('src/components/Data/DataHistory.tsx', 'utf8');

if (!content.includes('import ContextMenu')) {
    content = content.replace(
        "import { Logic } from '../../lib/logic';",
        "import { Logic } from '../../lib/logic';\nimport ContextMenu from '../ui/ContextMenu';\nimport { Pencil, Trash2 } from 'lucide-react';"
    );
}

content = content.replace(
    "onSelectEdit: (day: any) => void;",
    "onSelectEdit: (day: any) => void;\n    onDeleteMeasurement: (date: string) => void;"
);

content = content.replace(
    "onSelectEdit\n}) => {",
    "onSelectEdit,\n    onDeleteMeasurement\n}) => {"
);

content = content.replace(
    /onClick=\{\(\) => onSelectEdit\(day\)\}/g,
    ""
);

content = content.replace(
    /<div style=\{\{ color: 'var\(--primary-color\)', fontSize: '1\.1rem', opacity: 0\.8 \}\}>\s*✏️\s*<\/div>/g,
    `<div onClick={(e) => e.stopPropagation()}>
                                <ContextMenu
                                    items={[
                                        {
                                            label: 'Modifica',
                                            icon: <Pencil size={16} />,
                                            onClick: () => onSelectEdit(day)
                                        },
                                        {
                                            label: 'Elimina',
                                            icon: <Trash2 size={16} />,
                                            onClick: () => onDeleteMeasurement(day.date),
                                            danger: true
                                        }
                                    ]}
                                />
                            </div>`
);

content = content.replace(
    "Clicca su una voce per modificarla.",
    "Usa le opzioni per modificare o eliminare una misurazione."
);

fs.writeFileSync('src/components/Data/DataHistory.tsx', content, 'utf8');