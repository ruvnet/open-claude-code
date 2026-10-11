/**
 * Decode edit targets without silently replacing malformed byte sequences.
 * ignoreBOM retains a UTF-8 BOM so ordinary string edits preserve its bytes.
 */
import fs from 'node:fs';
import { TextDecoder } from 'node:util';

export function readStrictUtf8(filePath) {
    const bytes = fs.readFileSync(filePath);
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new Error('File is not valid UTF-8. Refusing to edit to avoid corrupting its encoding. Convert it to UTF-8 explicitly first.');
    }
}
