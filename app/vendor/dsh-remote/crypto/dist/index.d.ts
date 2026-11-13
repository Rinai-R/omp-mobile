export interface KeyPair {
    publicKey: string;
    privateKey: string;
}
export interface EncryptedFrame {
    nonce: string;
    ciphertext: string;
}
export declare function generateKeyPair(privateKeyBytes?: Uint8Array): KeyPair;
export declare function deriveSharedKey(privateKey: string, peerPublicKey: string, salt?: string): Uint8Array;
export declare function encryptFrame(key: Uint8Array, plaintext: Uint8Array, aad?: string): EncryptedFrame;
export declare function decryptFrame(key: Uint8Array, frame: EncryptedFrame, aad?: string): Uint8Array;
export declare function toBase64Url(bytes: Uint8Array): string;
export declare function fromBase64Url(value: string): Uint8Array;
export declare function identityFingerprint(publicKey: string): string;
export { NOISE_IK_PROTOCOL, NoiseIkSession, NoiseSessionError, createNoisePrologue, } from './noise.js';
export type { NoiseIkSessionOptions } from './noise.js';
