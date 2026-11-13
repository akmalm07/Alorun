// React Native runtimes may not provide the Encoding API needed by the vault.
import { TextEncoder as EncodingEncoder, TextDecoder as EncodingDecoder } from 'text-encoding';
if (!globalThis.TextEncoder) globalThis.TextEncoder = EncodingEncoder as typeof TextEncoder;
if (!globalThis.TextDecoder) globalThis.TextDecoder = EncodingDecoder as typeof TextDecoder;
