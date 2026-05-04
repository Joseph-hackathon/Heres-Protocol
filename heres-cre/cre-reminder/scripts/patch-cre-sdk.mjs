#!/usr/bin/env node

import fs from "fs";
import path from "path";

const compileFile = path.join(
  process.cwd(),
  "node_modules",
  "@chainlink",
  "cre-sdk",
  "scripts",
  "src",
  "compile-to-js.ts"
);

if (!fs.existsSync(compileFile)) {
  console.log(`[patch-cre-sdk] skipped: file not found (${compileFile})`);
  process.exit(0);
}

let content = fs.readFileSync(compileFile, "utf8");

const before = content;
content = content
  .split("target: 'browser',")
  .join("target: 'bun',");
content = content
  .split("await $`bun build ${builtFile} --bundle --outfile=${resolvedOutput}`")
  .join("await $`bun build ${builtFile} --bundle --target=bun --outfile=${resolvedOutput}`");

if (content !== before) {
  fs.writeFileSync(compileFile, content, "utf8");
  console.log("[patch-cre-sdk] applied compile target workaround");
} else {
  console.log("[patch-cre-sdk] compile target already patched");
}

const runtimeFile = path.join(
  process.cwd(),
  "node_modules",
  "@chainlink",
  "cre-sdk",
  "dist",
  "sdk",
  "utils",
  "prepare-runtime.js"
);

if (!fs.existsSync(runtimeFile)) {
  console.log(`[patch-cre-sdk] skipped runtime patch: file not found (${runtimeFile})`);
  process.exit(0);
}

const runtimeBefore = fs.readFileSync(runtimeFile, "utf8");
const runtimeAfter = `const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const decodeBase64 = (input) => {
    const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
    let output = [];
    for (let i = 0; i < clean.length; i += 4) {
        const enc1 = BASE64_CHARS.indexOf(clean.charAt(i));
        const enc2 = BASE64_CHARS.indexOf(clean.charAt(i + 1));
        const enc3 = BASE64_CHARS.indexOf(clean.charAt(i + 2));
        const enc4 = BASE64_CHARS.indexOf(clean.charAt(i + 3));
        const chr1 = (enc1 << 2) | (enc2 >> 4);
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        const chr3 = ((enc3 & 3) << 6) | enc4;
        output.push(chr1);
        if (enc3 !== 64)
            output.push(chr2);
        if (enc4 !== 64)
            output.push(chr3);
    }
    return new Uint8Array(output);
};
const encodeBase64 = (bytes) => {
    let output = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const chr1 = bytes[i];
        const chr2 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
        const chr3 = i + 2 < bytes.length ? bytes[i + 2] : NaN;
        const enc1 = chr1 >> 2;
        const enc2 = ((chr1 & 3) << 4) | ((chr2 || 0) >> 4);
        const enc3 = isNaN(chr2) ? 64 : (((chr2 & 15) << 2) | ((chr3 || 0) >> 6));
        const enc4 = isNaN(chr3) ? 64 : (chr3 & 63);
        output +=
            BASE64_CHARS.charAt(enc1) +
                BASE64_CHARS.charAt(enc2) +
                BASE64_CHARS.charAt(enc3) +
                BASE64_CHARS.charAt(enc4);
    }
    return output;
};
class BufferPolyfill extends Uint8Array {
    static from(input, encoding = 'utf8') {
        if (typeof input === 'string') {
            if (encoding === 'base64')
                return new BufferPolyfill(decodeBase64(input));
            if (encoding === 'hex') {
                const hex = input.length % 2 === 0 ? input : \`0\${input}\`;
                const out = new Uint8Array(hex.length / 2);
                for (let i = 0; i < hex.length; i += 2) {
                    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
                }
                return new BufferPolyfill(out);
            }
            return new BufferPolyfill(utf8Encoder.encode(input));
        }
        if (input instanceof ArrayBuffer)
            return new BufferPolyfill(new Uint8Array(input));
        if (ArrayBuffer.isView(input))
            return new BufferPolyfill(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
        if (Array.isArray(input))
            return new BufferPolyfill(Uint8Array.from(input));
        throw new TypeError('Unsupported input type for Buffer.from');
    }
    toString(encoding = 'utf8') {
        if (encoding === 'base64')
            return encodeBase64(this);
        if (encoding === 'hex')
            return Array.from(this)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        return utf8Decoder.decode(this);
    }
}
export const prepareRuntime = () => {
    if (typeof globalThis.Buffer === 'undefined') {
        globalThis.Buffer = BufferPolyfill;
    }
};
`;

if (runtimeAfter !== runtimeBefore) {
  fs.writeFileSync(runtimeFile, runtimeAfter, "utf8");
  console.log("[patch-cre-sdk] applied runtime buffer workaround");
} else {
  console.log("[patch-cre-sdk] runtime already patched");
}
