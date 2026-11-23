export function generateUniqueName(baseName: string, existingNames: string[]): string {
    const match = baseName.match(/^(.*?) - (\d+)$/);
    let rawName = baseName;
    if (match) {
        rawName = match[1];
    }
    const usedNames = new Set(existingNames);
    let counter = 1;
    let newName = `${rawName} - ${counter}`;
    while (usedNames.has(newName)) {
        counter++;
        newName = `${rawName} - ${counter}`;
    }
    return newName;
}