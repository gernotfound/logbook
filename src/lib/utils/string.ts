export function generateUniqueName(baseName: string, existingNames: string[]): string {
    const match = baseName.match(/^(.*?) - (\d+)$/);
    let rawName = baseName;
    if (match) {
        rawName = match[1];
    }
    let counter = 1;
    let newName = `${rawName} - ${counter}`;
    while (existingNames.includes(newName)) {
        counter++;
        newName = `${rawName} - ${counter}`;
    }
    return newName;
}